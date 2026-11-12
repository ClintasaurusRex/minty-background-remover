import { describe, expect, it } from 'vitest'
import { eyedropperClick } from '../editor/colourCommands'
import { type EditorState, type WorkspaceMetrics, displayViewport, initialEditorState } from '../editor/editorState'
import { opened, reduce } from '../editor/history/testFixtures'
import { magicWandClick } from '../editor/selectionCommands'
import type { PixelBuffer, Size, ViewportState } from '../editor/types'
import { createPixelBuffer } from '../image/pixelBuffer'
import { imageIndexAtDevicePixel, pixelUnderPointer } from './coordinates'
import { cropRectOnScreen } from './cropOverlay'
import { displayZoom, imageDrawBias, toDisplayViewport } from './devicePixels'
import { planFrame } from './rendering'
import { ZOOM_STEPS } from './viewport'
import { DOM_DELTA_PIXEL, wheelDeltaPixels, wheelZoomFactor } from './wheelZoom'

/*
 * What the workspace shows against what every tool assumes it shows (Phase 4 audit, M1 and M2, and
 * the arbitrary-zoom regression Codex found on 2026-11-11).
 *
 * The model of the browser here is independent of the production mapping: Chrome and Firefox fill a
 * device pixel D of an unsmoothed image with the image pixel under its centre, found with the
 * transform the renderer passes to setTransform: floor((D + 0.5 − e) / a). Which pixel they choose
 * when that position is an integer, or within their rounding of one, is unspecified (measured: the
 * right-hand column and upper row at 125% and 150% scaling, the left-hand column and upper row at
 * 147.65625% with the former 3/128 offset), so the display viewport must never produce one: every
 * centre is required to be at least 1/128 device pixel (and, up to 64 device pixels per image
 * pixel, 1/128 image pixel) from every image pixel edge. Only then can the model, and the tools, be
 * exact.
 *
 * Checked against the model, for display viewports (toDisplayViewport, as the app renders): the
 * pixel pointer tools read (Magic Wand, Eyedropper, status bar), the crop overlay's edges, the
 * checkerboard area and the selection overlay rule, at every zoom step from 100%, arbitrary
 * wheel-zoom levels (including 147.65625% and levels just either side of it), many device pixel
 * ratios (including Chrome's single-precision ratios and Firefox's 60 / n ones) and many pans.
 */

const RATIOS = [1, 1.1, 1.100000023841858, 1.2, 1.25, 4 / 3, 1.5, 1.75, 2, 2.25, 2.5, 3, 4, 0.8, 0.9, 60 / 55, 60 / 34, 60 / 67]
const TIE = 189 / 128
/** Pseudo-random wheel-zoom levels from 100% to 3200%, the same every run. */
const RANDOM_ZOOMS = (() => {
  let seed = 20261111
  const zooms = []
  for (let i = 0; i < 12; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    zooms.push(32 ** (seed / 2147483648))
  }
  return zooms
})()
const ZOOMS = [
  ...ZOOM_STEPS.filter((zoom) => zoom >= 1),
  // Codex's reproduction (exact, as reached by a synthetic wheel event, as reached by Chrome's real
  // wheel input) and levels just either side of it.
  TIE,
  1.4765624999999998,
  1.4765625127888868,
  TIE + 1e-6,
  TIE - 1e-6,
  1.25,
  1.875,
  2.2,
  3.7,
  1.0625,
  1.01789,
  2.3737,
  ...RANDOM_ZOOMS,
]
const OFFSETS = [
  { x: 0, y: 0 },
  { x: 37.3, y: 11.9 },
  { x: -413.37, y: 99.5 },
  { x: 801.6, y: -260.8 },
]
const IMAGE: Size = { width: 120, height: 80 }
/** How far (device pixels, and image pixels) every device pixel centre must stay from an image pixel edge. */
const CLEARANCE = 1 / 128 - 1e-9

/** The image column the browser draws at backing-store column D, by the transform alone. */
const drawnColumn = (device: number, e: number, a: number) => Math.floor((device + 0.5 - e) / a)

/** Distance (device pixels) from the centre of device pixel D to the nearest image pixel edge. */
function clearance(device: number, e: number, a: number): number {
  const position = (device + 0.5 - e) / a
  return Math.abs(position - Math.round(position)) * a
}

function views(): Array<{ viewport: ViewportState; ratio: number; label: string }> {
  const result = []
  for (const ratio of RATIOS) {
    for (const zoom of ZOOMS) {
      for (const offset of OFFSETS) {
        result.push({ viewport: toDisplayViewport({ zoom, offset }, ratio), ratio, label: `zoom ${zoom} ratio ${ratio} offset ${offset.x},${offset.y}` })
      }
    }
  }
  return result
}

describe('the image as the canvas draws it', () => {
  it('leaves no device pixel centre on or near an image pixel edge, at every zoom from 100%, arbitrary ones included', () => {
    let worst = Infinity
    let worstInImagePixels = Infinity
    let views_ = 0
    for (const { viewport, ratio } of views()) {
      const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
      // Smoothed views (exactly 100% at a ratio off the grid, Option D) blend; no tie to break.
      if (!plan.image || plan.image.smoothing) continue
      views_++
      const { e, f, a } = plan.image.transform
      for (const [start, size] of [[e, IMAGE.width], [f, IMAGE.height]]) {
        const corner = Math.round(start)
        for (let d = 0; d < size * a; d++) {
          const distance = clearance(corner + d, start, a)
          worst = Math.min(worst, distance)
          if (a <= 64) worstInImagePixels = Math.min(worstInImagePixels, distance / a)
        }
      }
    }
    expect(views_).toBeGreaterThan(1500)
    expect(worst).toBeGreaterThanOrEqual(CLEARANCE)
    expect(worstInImagePixels).toBeGreaterThanOrEqual(CLEARANCE)
  })

  it('without a bias, zoom steps would put centres exactly on edges (the first audited defect)', () => {
    // 100% at 125% scaling: device pixel 97 is centred on the edge between columns 77 and 78.
    expect(clearance(97, 0, 1.25)).toBe(0)
    // 100% at 150% scaling: device pixel 55 is centred on the edge between columns 36 and 37.
    expect(clearance(55, 0, 1.5)).toBe(0)
  })

  it('with the former fixed 3/128 bias, 147.65625% put a centre exactly on an edge (the arbitrary-zoom regression)', () => {
    // Codex, 2026-11-11: device pixel 1 from the image's corner is centred on the edge between
    // columns 0 and 1 (189/128 + 3/128 = 1.5), so browsers chose column 0 while the tools read 1.
    expect(clearance(1, 3 / 128, TIE)).toBe(0)
    // No fixed bias can avoid this: for any bias b, the scale 1 + (1/2 − b) puts edge 1 on centre 1.
    for (const b of [0, 1 / 64, 3 / 128, 0.1, 0.37]) expect(clearance(1, b, 1.5 - b)).toBeLessThan(1e-12)
  })
})

describe('the display scale grid', () => {
  it('shows the zoom steps exactly as requested at the usual device pixel ratios', () => {
    // Display scaling in quarters: every step.
    for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4, 60 / 48, 60 / 40]) {
      for (const zoom of ZOOM_STEPS) expect(displayZoom(zoom, ratio)).toBeCloseTo(zoom, 12)
    }
    // Browser zoom (110%, 133%; Firefox's 60 / n ratios such as 12/11 and 30/17): every step up to
    // 200%; higher steps can need a numerator above GRID_LIMIT (1200% at 110% is 66/5) and are shown
    // within 1.6% (checked below).
    for (const ratio of [1.1, 4 / 3, 60 / 55, 60 / 45, 60 / 34]) {
      for (const zoom of ZOOM_STEPS.filter((step) => step <= 2)) expect(displayZoom(zoom, ratio)).toBeCloseTo(zoom, 12)
    }
    // A single-precision ratio (Chrome at 110%): 100% stays exactly 100%.
    expect(displayZoom(1, 1.100000023841858)).toBe(1)
  })

  it('moves other zoom levels from 100% by at most 1.6% (one whole step, 3.125%, at the 3200% limit), never below 100% or above 3200%, and leaves zoom below 100% alone', () => {
    let worst = 0
    let worstAtTop = 0
    for (const ratio of RATIOS) {
      for (let zoom = 1; zoom <= 32; zoom *= 1.0123) {
        const shown = displayZoom(zoom, ratio)
        expect(shown).toBeGreaterThanOrEqual(1)
        expect(shown).toBeLessThanOrEqual(32 * (1 + 1e-7))
        const error = Math.abs(shown / zoom - 1)
        // Within one whole device scale step of the limit, the next grid scale up may be above it.
        if (zoom * ratio + 1 > 32 * ratio) worstAtTop = Math.max(worstAtTop, error)
        else worst = Math.max(worst, error)
      }
      for (const zoom of [0.01, 0.137, 0.5, 2 / 3, 0.999999]) expect(displayZoom(zoom, ratio)).toBe(zoom)
    }
    expect(worst).toBeLessThan(0.016)
    expect(worstAtTop).toBeLessThan(1 / 32)
    // Codex's reproduction is shown at 31/21 (147.619%), 0.026% from the requested 147.65625%.
    expect(displayZoom(TIE, 1)).toBe(31 / 21)
  })

  it('is stable: the displayed zoom is displayed as itself, with the same bias', () => {
    for (const ratio of RATIOS) {
      for (const zoom of ZOOMS) {
        const shown = displayZoom(zoom, ratio)
        expect(displayZoom(shown, ratio)).toBe(shown)
        expect(imageDrawBias(shown * ratio)).toBe(imageDrawBias(displayZoom(shown, ratio) * ratio))
      }
    }
  })
})

describe('tools against the image as drawn', () => {
  it('pointer tools read exactly the pixel drawn under the pointer, anywhere in its device pixel', () => {
    let checked = 0
    for (const { viewport, ratio, label } of views()) {
      const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
      if (!plan.image) continue
      const { e, f, a } = plan.image.transform
      for (let D = 0; D < plan.backingStore.width; D += 7) {
        const column = drawnColumn(D, e, a)
        const row = drawnColumn(D, f, a)
        // Not closer to the next device pixel than devicePixels.ts's DEVICE_EDGE_TOLERANCE (0.01).
        for (const inside of [0, 0.5, 0.95]) {
          const pointer = { x: (D + inside) / ratio, y: (D + inside) / ratio }
          const hit = pixelUnderPointer(viewport, pointer, IMAGE, ratio)
          const shown = column >= 0 && column < IMAGE.width && row >= 0 && row < IMAGE.height ? { x: column, y: row } : null
          if (JSON.stringify(hit) !== JSON.stringify(shown)) throw new Error(`${label}, device ${D}: hit ${JSON.stringify(hit)}, drawn ${JSON.stringify(shown)}`)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(500000)
  })

  it('the crop overlay starts and stops exactly where the canvas draws the first and last kept columns and rows', () => {
    let checked = 0
    for (const { viewport, ratio, label } of views()) {
      const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
      if (!plan.image) continue
      const { e, f, a } = plan.image.transform
      for (const rect of [
        { x: 37, y: 21, width: 41, height: 33 },
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 1, y: 1, width: 41, height: 33 },
        { x: 1, y: 3, width: 118, height: 76 },
        { x: 119, y: 79, width: 1, height: 1 },
      ]) {
        const screen = cropRectOnScreen(rect, viewport, ratio)
        // The overlay's edges in backing-store pixels: whole device pixels.
        const [left, top, right, bottom] = [screen.x, screen.y, screen.x + screen.width, screen.y + screen.height].map((v) => v * ratio)
        for (const edge of [left, top, right, bottom]) expect(Math.abs(edge - Math.round(edge))).toBeLessThan(1e-6)
        const [L, T, R, B] = [left, top, right, bottom].map(Math.round)
        // Magnified, every column is drawn, so the edges are exactly at the first and last kept ones.
        // Below one device pixel per image pixel (a device pixel ratio below 1 at 100%), some columns
        // are never drawn: the edges then separate exactly the device pixels showing kept columns.
        const wrong =
          a >= 1
            ? [
                drawnColumn(L, e, a) !== rect.x,
                drawnColumn(L - 1, e, a) !== rect.x - 1,
                drawnColumn(R - 1, e, a) !== rect.x + rect.width - 1,
                drawnColumn(R, e, a) !== rect.x + rect.width,
                drawnColumn(T, f, a) !== rect.y,
                drawnColumn(T - 1, f, a) !== rect.y - 1,
                drawnColumn(B - 1, f, a) !== rect.y + rect.height - 1,
                drawnColumn(B, f, a) !== rect.y + rect.height,
              ]
            : [
                drawnColumn(L, e, a) < rect.x,
                drawnColumn(L - 1, e, a) >= rect.x,
                drawnColumn(R - 1, e, a) >= rect.x + rect.width,
                drawnColumn(R, e, a) < rect.x + rect.width,
                drawnColumn(T, f, a) < rect.y,
                drawnColumn(T - 1, f, a) >= rect.y,
                drawnColumn(B - 1, f, a) >= rect.y + rect.height,
                drawnColumn(B, f, a) < rect.y + rect.height,
              ]
        if (wrong.some(Boolean)) throw new Error(`${label}, crop ${JSON.stringify(rect)}: ${JSON.stringify({ L, T, R, B, wrong })}`)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(5000)
  })

  it('the checkerboard covers exactly the device pixels the image is drawn on', () => {
    for (const { viewport, ratio, label } of views()) {
      const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
      if (!plan.checker) continue
      const { e, f, a } = plan.image!.transform
      const { x, y, width, height } = plan.checker.rect
      const inImage = (device: number, start: number, size: number) => drawnColumn(device, start, a) >= 0 && drawnColumn(device, start, a) < size
      const ok =
        inImage(x, e, IMAGE.width) &&
        inImage(x + width - 1, e, IMAGE.width) &&
        (x + width === plan.backingStore.width || !inImage(x + width, e, IMAGE.width)) &&
        (x === 0 || !inImage(x - 1, e, IMAGE.width)) &&
        inImage(y, f, IMAGE.height) &&
        inImage(y + height - 1, f, IMAGE.height) &&
        (y + height === plan.backingStore.height || !inImage(y + height, f, IMAGE.height)) &&
        (y === 0 || !inImage(y - 1, f, IMAGE.height))
      if (!ok) throw new Error(`${label}: checker ${JSON.stringify(plan.checker.rect)}`)
    }
  })

  it('the selection overlay rule (imageIndexAtDevicePixel) is the column the canvas draws', () => {
    for (const { viewport, ratio, label } of views()) {
      const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
      if (!plan.image) continue
      const { e, a } = plan.image.transform
      // The overlay works the bias out once per tile, as here.
      const bias = imageDrawBias(a)
      const corner = Math.round(viewport.offset.x * ratio)
      for (let D = Math.max(0, corner - 3); D < corner + IMAGE.width * a + 3; D++) {
        if (imageIndexAtDevicePixel(D - corner, a, bias) !== drawnColumn(D, e, a)) throw new Error(`${label}, device ${D}`)
        if (imageIndexAtDevicePixel(D - corner, a) !== drawnColumn(D, e, a)) throw new Error(`${label}, device ${D} (default bias)`)
      }
    }
  })
})

/** 120 × 80, every pixel different: red 2 × column, green 3 × row (as the browser scripts' crop-columns.png). */
function columnsImage(): PixelBuffer {
  const data = new Uint8ClampedArray(IMAGE.width * IMAGE.height * 4)
  for (let y = 0; y < IMAGE.height; y++) {
    for (let x = 0; x < IMAGE.width; x++) data.set([x * 2, y * 3, (x * 7 + y * 11) % 256, 255], (y * IMAGE.width + x) * 4)
  }
  return createPixelBuffer(IMAGE.width, IMAGE.height, data)
}

describe('the arbitrary-zoom regression through the editor (Codex, 2026-11-11)', () => {
  // The Ctrl + wheel input that takes 100% to 147.65625%, through the same conversion as the
  // workspace's wheel handler (workspaceInput.ts): one pixel-mode wheel event.
  const deltaY = (-100 * Math.log(TIE)) / Math.log(1.25)

  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
    it(`Eyedropper, Magic Wand, status bar and crop overlay agree with the canvas after Ctrl + wheel to 147.65625%, panned, at device pixel ratio ${devicePixelRatio}`, () => {
      const workspace: WorkspaceMetrics = { size: { width: 1000, height: 600 }, devicePixelRatio }
      const base = opened(columnsImage(), reduce(initialEditorState, { type: 'workspace-resized', workspace }))
      const factor = wheelZoomFactor(wheelDeltaPixels(deltaY, DOM_DELTA_PIXEL, workspace.size.height))
      const zoomed = reduce(base, { type: 'zoom-actual-size' }, { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor })
      expect(zoomed.viewport!.zoom).toBeCloseTo(TIE, 12)
      let checked = 0
      for (const pan of [null, { x: 0.3, y: 0.7 }, { x: 13.1, y: -7.4 }, { x: -101.37, y: 55.55 }]) {
        const state = pan ? reduce(zoomed, { type: 'wheel-panned', delta: pan }) : zoomed
        const v = displayViewport(state)!
        const { e, f, a } = planFrame({ imageSize: IMAGE, viewport: v, viewportSize: workspace.size, devicePixelRatio }).image!.transform
        const corner = { x: Math.round(v.offset.x * devicePixelRatio), y: Math.round(v.offset.y * devicePixelRatio) }
        const eyedropper = reduce(state, { type: 'tool-selected', tool: 'eyedropper' })
        // Every device pixel across the first 40 image columns and rows (and one before), along the
        // diagonal and next to it, at its corner and inside it.
        for (let D = -1; D < 40 * a; D++) {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
            for (const inside of [0, 0.5, 0.95]) {
              const X = corner.x + D + dx
              const Y = corner.y + D + dy
              const point = { x: (X + inside) / devicePixelRatio, y: (Y + inside) / devicePixelRatio }
              // The model names the pixel the browser draws only where no edge is within its
              // rounding of the device pixel's centre; at a tie the browser's choice is unknown.
              if (clearance(X, e, a) < CLEARANCE || clearance(Y, f, a) < CLEARANCE) {
                throw new Error(`pan ${JSON.stringify(pan)}, device (${X}, ${Y}): an image pixel edge passes through its centre; the browser's choice is unspecified`)
              }
              const column = drawnColumn(X, e, a)
              const row = drawnColumn(Y, f, a)
              const shown = column >= 0 && column < IMAGE.width && row >= 0 && row < IMAGE.height ? { x: column, y: row } : null
              const sample = eyedropperClick(eyedropper, point)
              const wand = magicWandClick(state, point, 'new')
              const status = pixelUnderPointer(v, point, IMAGE, devicePixelRatio)
              const read = sample?.type === 'colour-sampled' ? sample.pixel : null
              const seed = wand?.type === 'magic-wand-applied' ? wand.operation.seed : null
              if (JSON.stringify([read, seed, status]) !== JSON.stringify([shown, shown, shown])) {
                throw new Error(`pan ${JSON.stringify(pan)}, device (${X}, ${Y}): drawn ${JSON.stringify(shown)}, Eyedropper ${JSON.stringify(read)}, Magic Wand ${JSON.stringify(seed)}, status bar ${JSON.stringify(status)}`)
              }
              if (sample?.type === 'colour-sampled') {
                expect(sample.colour).toEqual({ r: column * 2, g: row * 3, b: (column * 7 + row * 11) % 256, a: 255 })
              }
              checked++
            }
          }
        }
        // Codex's crop rectangle starting at pixel (1, 1).
        for (const rect of [{ x: 1, y: 1, width: 41, height: 33 }, { x: 37, y: 21, width: 41, height: 33 }]) {
          const screen = cropRectOnScreen(rect, v, devicePixelRatio)
          const [L, T, R, B] = [screen.x, screen.y, screen.x + screen.width, screen.y + screen.height].map((value) => Math.round(value * devicePixelRatio))
          expect([drawnColumn(L - 1, e, a), drawnColumn(L, e, a), drawnColumn(R - 1, e, a), drawnColumn(R, e, a)]).toEqual([rect.x - 1, rect.x, rect.x + rect.width - 1, rect.x + rect.width])
          expect([drawnColumn(T - 1, f, a), drawnColumn(T, f, a), drawnColumn(B - 1, f, a), drawnColumn(B, f, a)]).toEqual([rect.y - 1, rect.y, rect.y + rect.height - 1, rect.y + rect.height])
        }
      }
      expect(checked).toBeGreaterThan(1000)
    })
  }

  it('the displayed scale after that wheel zoom leaves every centre clear of every edge', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
      const workspace: WorkspaceMetrics = { size: { width: 1000, height: 600 }, devicePixelRatio }
      const state: EditorState = reduce(
        opened(columnsImage(), reduce(initialEditorState, { type: 'workspace-resized', workspace })),
        { type: 'zoom-actual-size' },
        { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor: wheelZoomFactor(wheelDeltaPixels(deltaY, DOM_DELTA_PIXEL, 600)) },
      )
      const { e, a } = planFrame({ imageSize: IMAGE, viewport: displayViewport(state)!, viewportSize: workspace.size, devicePixelRatio }).image!.transform
      const corner = Math.round(e)
      for (let d = 0; d < IMAGE.width * a; d++) expect(clearance(corner + d, e, a)).toBeGreaterThanOrEqual(CLEARANCE)
    }
  })
})

/*
 * The clearance guarantee with the classification tolerance (Codex, 2026-11-11 follow-up).
 *
 * In exact arithmetic, a scale s that is exactly a grid scale p / q (lowest terms) leaves every
 * device pixel centre at least 1 / (2q) device pixels from every image pixel edge. imageDrawBias
 * also accepts scales within GRID_TOLERANCE (relative 1e-7) of a grid scale g, which happens at 100%
 * only, where the scale is the device pixel ratio itself (a single-precision ratio, or Codex's
 * 1.0158731073015872, 9.1e-8 above 64/63). Edge k of the image then lies k·|s − g| from where it
 * would be at g, so the bound over an image of N pixels is 1 / (2q) − N·|s − g|. For the largest
 * importable side (16,384) and |s − g| ≤ 1e-7·g with g ≤ 64 / q (p ≤ 64), that is at least
 * (1/2 − 16,384 × 64 × 1e-7) / q ≥ 0.395 / q device pixels (≥ 0.395 / p image pixels), at least
 * 1/162 of either: not the 1/128 claimed before. The checks below measure it independently.
 */
describe('the clearance guarantee, with the classification tolerance (Codex 2026-11-11)', () => {
  const MAX_SIDE = 16_384

  /** Worst distance (device px) from a device pixel centre to edges 0 … `edges` drawn at scale `s`, shifted by `bias`. */
  function worstClearance(s: number, bias: number, edges: number): { distance: number; edge: number } {
    let distance = Infinity
    let edge = -1
    for (let k = 0; k <= edges; k++) {
      // Edge k is drawn at k·s + bias device pixels from the image's corner (a device pixel edge).
      const fromCentre = k * s + bias - 0.5
      const d = Math.abs(fromCentre - Math.round(fromCentre))
      if (d < distance) {
        distance = d
        edge = k
      }
    }
    return { distance, edge }
  }

  it("confirms Codex's counterexample: 100% at ratio 1.0158731073015872 leaves 0.00644 device pixels at edge 16,348", () => {
    const ratio = 1.0158731073015872
    expect(displayZoom(1, ratio)).toBe(1)
    const scale = 1 * ratio
    // Accepted as 64/63 (q odd: no bias), 9.1e-8 relatively above it.
    expect(imageDrawBias(scale)).toBe(0)
    expect(Math.abs(scale / (64 / 63) - 1)).toBeLessThan(1e-7)
    const at = worstClearance(scale, 0, 16_348)
    expect(at.edge).toBe(16_348)
    expect(at.distance).toBeCloseTo(0.00644183, 7)
    expect(at.distance).toBeLessThan(1 / 128)
    // The tolerance-aware bound holds, and so does the documented floor 0.395 / q.
    const bound = 1 / (2 * 63) - MAX_SIDE * Math.abs(scale - 64 / 63)
    expect(worstClearance(scale, 0, MAX_SIDE).distance).toBeGreaterThanOrEqual(bound)
    expect(bound).toBeGreaterThanOrEqual(0.395 / 63)
  })

  it('holds 1/(2q) − N·|s − g| ≥ 0.395/q device px (and 0.395/p texels) for every grid scale at the edge of the tolerance, up to the largest side', () => {
    const grid: Array<{ p: number; q: number }> = []
    for (let q = 1; q <= 64; q++) {
      for (let p = 1; p <= 64; p++) {
        let a = p
        let b = q
        while (b) [a, b] = [b, a % b]
        if (a === 1 && p / q >= 0.9) grid.push({ p, q })
      }
    }
    let checked = 0
    for (const { p, q } of grid) {
      const g = p / q
      for (const s of [g * (1 + 0.999e-7), g * (1 - 0.999e-7)]) {
        const bias = imageDrawBias(s)
        expect(bias).toBe(q % 2 === 0 ? 1 / (2 * q) : 0)
        const { distance } = worstClearance(s, bias, MAX_SIDE)
        const bound = 1 / (2 * q) - MAX_SIDE * Math.abs(s - g)
        expect(distance).toBeGreaterThanOrEqual(bound - 1e-10)
        expect(distance).toBeGreaterThanOrEqual(0.395 / q)
        expect(distance / s).toBeGreaterThanOrEqual(0.395 / p - 1e-10)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(2000)
  })

  it('keeps 1/(2q) (at least 1/128) for scales actually displayed above 100%, which are grid scales to within rounding, up to the largest side', () => {
    let worst = Infinity
    for (const ratio of RATIOS) {
      for (const zoom of [1.0001, 1.13, TIE, 2.3737, 3.33, 7.77, 12.5, 23.9, 31.9]) {
        const scale = displayZoom(zoom, ratio) * ratio
        const { distance } = worstClearance(scale, imageDrawBias(scale), MAX_SIDE)
        worst = Math.min(worst, distance, scale <= 64 ? distance / scale : Infinity)
      }
    }
    expect(worst).toBeGreaterThanOrEqual(1 / 128 - 1e-9)
  })
})

describe('display grid transitions and the 100% boundary', () => {
  /** Grid scales (p / q, p and q ≤ 64, and whole numbers) in [low, high], ascending. */
  function gridScales(low: number, high: number): number[] {
    const values = new Set<number>()
    for (let q = 1; q <= 64; q++) for (let p = 1; p <= 64 * q; p++) if (p / q >= low && p / q <= high && (q === 1 || p <= 64)) values.add(p / q)
    return [...values].sort((a, b) => a - b)
  }

  it('agrees on both sides of every transition between neighbouring displayed scales', () => {
    let transitions = 0
    for (const ratio of [1, 1.1, 1.25, 1.5, 2, 3]) {
      for (const scales of [gridScales(ratio * 1.3, ratio * 1.4), gridScales(31, 34), gridScales(ratio, ratio * 1.02)]) {
        for (let i = 1; i < scales.length; i++) {
          const middle = (scales[i - 1] + scales[i]) / 2
          if (middle / ratio < 1 || middle / ratio > 32) continue
          for (const side of [1 - 1e-9, 1 + 1e-9]) {
            const viewport = toDisplayViewport({ zoom: (middle * side) / ratio, offset: { x: 13.37, y: -7.71 } }, ratio)
            const plan = planFrame({ imageSize: IMAGE, viewport, viewportSize: { width: 1600, height: 900 }, devicePixelRatio: ratio })
            if (!plan.image) continue
            const { e, a } = plan.image.transform
            // One of the two neighbours, never something in between.
            if (![scales[i - 1], scales[i]].some((s) => Math.abs(a - s) < 1e-12 * s)) throw new Error(`ratio ${ratio}: between ${scales[i - 1]} and ${scales[i]}, side ${side}: drawn at ${a}`)
            for (let D = Math.max(0, Math.round(e)); D < Math.min(plan.backingStore.width, Math.round(e) + IMAGE.width * a); D++) {
              expect(clearance(D, e, a)).toBeGreaterThanOrEqual(CLEARANCE)
              const column = drawnColumn(D, e, a)
              const hit = pixelUnderPointer(viewport, { x: (D + 0.5) / ratio, y: (Math.round(plan.image.transform.f) + 0.5) / ratio }, IMAGE, ratio)
              if (column < IMAGE.width) expect(hit?.x).toBe(column)
            }
            transitions++
          }
        }
      }
    }
    expect(transitions).toBeGreaterThan(100)
  })

  it('draws 100% exactly at the ratio on the grid, crisp, and smooths only below 100%', () => {
    for (const ratio of [1, 1.1, 1.100000023841858, 1.25, 1.5, 2, 3, 60 / 59, 60 / 55]) {
      const at = (zoom: number) =>
        planFrame({ imageSize: IMAGE, viewport: toDisplayViewport({ zoom, offset: { x: 10, y: 10 } }, ratio), viewportSize: { width: 800, height: 600 }, devicePixelRatio: ratio }).image!
      expect(at(1).transform.a).toBe(ratio)
      expect(at(1).smoothing).toBe(false)
      expect(at(1 + 1e-12).smoothing).toBe(false)
      expect(at(1 - 1e-12).smoothing).toBe(true)
    }
  })
})

/*
 * Actual Size (owner decision: Option D, Phase 4 zoom follow-up). Exactly 100% is one image pixel
 * per CSS pixel at every device pixel ratio: crisp where the ratio is a grid scale, smoothed where
 * it is not. The oracle is the renderer's plan (planFrame): its transform and smoothing flag.
 */
describe('Actual Size (Option D)', () => {
  const ON_GRID = [1, 1.1, 1.100000023841858, 1.25, 1.5, 2, 3, 60 / 59, 60 / 55, 1.75, 2.25]
  // Chrome at 101% and 119% custom scaling and at 225% × 90% browser zoom; 60/67 (Firefox at 90%
  // of 100%, q = 67 > 64); a fractional desktop scale (2560/1463).
  const OFF_GRID = [1.0099999904632568, 1.01, Math.fround(1.19), Math.fround(2.025), 60 / 67, 2560 / 1463]
  const IMAGE_SIZE = { width: 120, height: 80 }

  function actualSize(devicePixelRatio: number): EditorState {
    const workspace: WorkspaceMetrics = { size: { width: 1003.7, height: 611.3 }, devicePixelRatio }
    return reduce(opened(columnsImage(), reduce(initialEditorState, { type: 'workspace-resized', workspace })), { type: 'zoom-scaled', anchor: { x: 400, y: 300 }, factor: 3.7 }, { type: 'zoom-actual-size' })
  }

  it('displays exactly 100% (scale = device pixel ratio) at every ratio, crisp on the grid and smoothed off it', () => {
    for (const ratio of [...ON_GRID, ...OFF_GRID]) {
      const state = actualSize(ratio)
      expect(state.viewport!.zoom).toBe(1)
      const view = displayViewport(state)!
      expect(view.zoom).toBe(1)
      const image = planFrame({ imageSize: IMAGE_SIZE, viewport: view, viewportSize: state.workspace!.size, devicePixelRatio: ratio }).image!
      expect(image.transform.a).toBe(ratio)
      expect(image.transform.d).toBe(ratio)
      expect(image.smoothing).toBe(OFF_GRID.includes(ratio))
      // Off the grid there is no drawing offset: the corner is a whole device pixel.
      if (OFF_GRID.includes(ratio)) expect(Math.abs(image.transform.e - Math.round(image.transform.e))).toBeLessThan(1e-9)
    }
  })

  it('off the grid, the Eyedropper, Magic Wand and status bar read the stored pixel nearest each device pixel centre (the largest part of the blend), with exact bytes', () => {
    for (const ratio of OFF_GRID) {
      const state = actualSize(ratio)
      const view = displayViewport(state)!
      const { e, f, a } = planFrame({ imageSize: IMAGE_SIZE, viewport: view, viewportSize: state.workspace!.size, devicePixelRatio: ratio }).image!.transform
      const eyedropper = reduce(state, { type: 'tool-selected', tool: 'eyedropper' })
      let checked = 0
      for (let D = Math.round(e) - 1; D < Math.round(e) + 125 * a; D++) {
        const Y = Math.round(f) + (D % 83)
        const point = { x: (D + 0.37) / ratio, y: (Y + 0.61) / ratio }
        // The image position at the device pixel's centre, through the drawing transform.
        const u = (D + 0.5 - e) / a
        const v = (Y + 0.5 - f) / a
        const nearest = u >= 0 && u < 120 && v >= 0 && v < 80 ? { x: Math.floor(u), y: Math.floor(v) } : null
        if (nearest) {
          // Its centre is within half an image pixel of the device pixel's centre: the largest weight.
          expect(Math.abs(u - (nearest.x + 0.5))).toBeLessThanOrEqual(0.5)
        }
        const sample = eyedropperClick(eyedropper, point)
        const wand = magicWandClick(state, point, 'new')
        const status = pixelUnderPointer(view, point, IMAGE_SIZE, ratio)
        expect(sample?.type === 'colour-sampled' ? sample.pixel : null).toEqual(nearest)
        expect(wand?.type === 'magic-wand-applied' ? wand.operation.seed : null).toEqual(nearest)
        expect(status).toEqual(nearest)
        if (nearest && sample?.type === 'colour-sampled') {
          expect(sample.colour).toEqual({ r: nearest.x * 2, g: nearest.y * 3, b: (nearest.x * 7 + nearest.y * 11) % 256, a: 255 })
          checked++
        }
      }
      expect(checked).toBeGreaterThan(70)
    }
  })

  it('off the grid, the crop overlay edges are where the drawn pixel nearest each device pixel centre changes', () => {
    for (const ratio of OFF_GRID) {
      const state = actualSize(ratio)
      const view = displayViewport(state)!
      const { e, f, a } = planFrame({ imageSize: IMAGE_SIZE, viewport: view, viewportSize: state.workspace!.size, devicePixelRatio: ratio }).image!.transform
      for (const rect of [{ x: 1, y: 1, width: 41, height: 33 }, { x: 37, y: 21, width: 41, height: 33 }]) {
        const screen = cropRectOnScreen(rect, view, ratio)
        const [L, T, R, B] = [screen.x, screen.y, screen.x + screen.width, screen.y + screen.height].map((value) => value * ratio)
        // Whole device pixels.
        for (const edge of [L, T, R, B]) expect(Math.abs(edge - Math.round(edge))).toBeLessThan(1e-6)
        const [l, t, r, b] = [L, T, R, B].map(Math.round)
        if (a >= 1) {
          expect([drawnColumn(l - 1, e, a), drawnColumn(l, e, a), drawnColumn(r - 1, e, a), drawnColumn(r, e, a)]).toEqual([rect.x - 1, rect.x, rect.x + rect.width - 1, rect.x + rect.width])
          expect([drawnColumn(t - 1, f, a), drawnColumn(t, f, a), drawnColumn(b - 1, f, a), drawnColumn(b, f, a)]).toEqual([rect.y - 1, rect.y, rect.y + rect.height - 1, rect.y + rect.height])
        } else {
          // Below one device pixel per image pixel some pixels are drawn nowhere: the edges separate
          // the pixels drawn before them from those drawn after.
          expect(drawnColumn(l - 1, e, a) < rect.x && drawnColumn(l, e, a) >= rect.x).toBe(true)
          expect(drawnColumn(r - 1, e, a) < rect.x + rect.width && drawnColumn(r, e, a) >= rect.x + rect.width).toBe(true)
          expect(drawnColumn(t - 1, f, a) < rect.y && drawnColumn(t, f, a) >= rect.y).toBe(true)
          expect(drawnColumn(b - 1, f, a) < rect.y + rect.height && drawnColumn(b, f, a) >= rect.y + rect.height).toBe(true)
        }
      }
    }
  })

  it('anything but exactly 100% is unchanged: just above it is crisp on the grid, just below it smoothed', () => {
    for (const ratio of OFF_GRID.filter((r) => r >= 1)) {
      const above = toDisplayViewport({ zoom: 1 + 1e-6, offset: { x: 0, y: 0 } }, ratio)
      const plan = planFrame({ imageSize: IMAGE_SIZE, viewport: above, viewportSize: { width: 800, height: 600 }, devicePixelRatio: ratio }).image!
      expect(plan.smoothing).toBe(false)
      expect(above.zoom).toBeGreaterThanOrEqual(1)
      const below = toDisplayViewport({ zoom: 1 - 1e-6, offset: { x: 0, y: 0 } }, ratio)
      expect(planFrame({ imageSize: IMAGE_SIZE, viewport: below, viewportSize: { width: 800, height: 600 }, devicePixelRatio: ratio }).image!.smoothing).toBe(true)
    }
  })
})

