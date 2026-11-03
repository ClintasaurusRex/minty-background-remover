import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionMask, Size } from '../editor/types'
import { createSelectionMask } from '../image/selection/selectionMask'
import { selectAll } from '../image/selection/selectionOperations'
import { snapToDevicePixels } from './devicePixels'
import { type AnimationClock, createMarchingAnts } from './marchingAnts'
import {
  type BoundaryPattern,
  MARCHING_ANTS_PHASES,
  STATIC_BOUNDARY,
  type SelectionOverlayPlan,
  marchingBoundary,
  planSelectionOverlay,
  rasteriseOverlayTile,
  rasteriseSelectionOverlay,
} from './selectionOverlay'
import { type SelectionOverlayRenderer, createSelectionOverlayRenderer } from './selectionOverlayRenderer'

/*
 * The renderer against a small software canvas: putImageData, drawImage (source-over, whole
 * pixels, no scaling) and clearRect on 32-bit pixels, so frames can be compared with a fresh
 * rasterisation pixel for pixel and every canvas call counted.
 */

class FakeImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

/** The alpha byte of a pixel stored as 32 bits in ImageData byte order. */
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1
const alpha = (pixel: number) => (LITTLE_ENDIAN ? pixel >>> 24 : pixel & 255)

/** Whether the (fake) GPU is down: drawing does nothing, as on a lost context. */
const gpu = { lost: false }

class FakeContext {
  imageSmoothingEnabled = true
  readonly calls = { putImageData: 0, drawImage: 0, clearRect: 0 }
  /** Translucent pixels drawn over translucent pixels: tint drawn twice. */
  overlaps = 0
  readonly canvas: FakeCanvas
  constructor(canvas: FakeCanvas) {
    this.canvas = canvas
  }

  setTransform() {}

  clearRect(x: number, y: number, width: number, height: number) {
    this.calls.clearRect++
    if (gpu.lost) return
    const { pixels, width: w, height: h } = this.canvas
    for (let r = Math.max(0, y); r < Math.min(h, y + height); r++) pixels.fill(0, r * w + Math.max(0, x), r * w + Math.min(w, x + width))
  }

  putImageData(image: FakeImageData, dx: number, dy: number, sx = 0, sy = 0, sw = image.width, sh = image.height) {
    this.calls.putImageData++
    if (gpu.lost) return
    const source = new Uint32Array(image.data.buffer)
    const { pixels, width: w, height: h } = this.canvas
    for (let r = 0; r < sh; r++) {
      for (let c = 0; c < sw; c++) {
        const x = dx + sx + c
        const y = dy + sy + r
        if (x >= 0 && y >= 0 && x < w && y < h) pixels[y * w + x] = source[(sy + r) * image.width + sx + c]
      }
    }
  }

  drawImage(source: FakeCanvas, ...args: number[]) {
    this.calls.drawImage++
    // drawImage(image, dx, dy) or drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) without scaling.
    const [sx, sy, sw, sh, dx, dy] = args.length === 2 ? [0, 0, source.width, source.height, args[0], args[1]] : args
    if (args.length !== 2) expect([args[6], args[7]]).toEqual([sw, sh])
    expect(this.imageSmoothingEnabled).toBe(false)
    if (gpu.lost) return
    const { pixels, width: w, height: h } = this.canvas
    for (let r = 0; r < sh; r++) {
      for (let c = 0; c < sw; c++) {
        const x = dx + c
        const y = dy + r
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const pixel = source.pixels[(sy + r) * source.width + sx + c]
        const a = alpha(pixel)
        if (a === 0) continue
        const target = y * w + x
        if (a !== 255 && alpha(pixels[target]) !== 0) this.overlaps++
        pixels[target] = pixel
      }
    }
  }
}

class FakeCanvas {
  #width = 300
  #height = 150
  pixels = new Uint32Array(300 * 150)
  readonly context = new FakeContext(this)
  get width() {
    return this.#width
  }
  set width(value: number) {
    this.#width = value
    this.pixels = new Uint32Array(this.#width * this.#height)
  }
  get height() {
    return this.#height
  }
  set height(value: number) {
    this.#height = value
    this.pixels = new Uint32Array(this.#width * this.#height)
  }
  getContext(type: string) {
    return type === '2d' ? this.context : null
  }
  readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener)
  }
  fire(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }
  /** What a restored context looks like: no pixels, and the context state back to its defaults. */
  blank() {
    this.pixels.fill(0)
    this.context.imageSmoothingEnabled = true
  }
}

let created: FakeCanvas[] = []

beforeEach(() => {
  created = []
  gpu.lost = false
  vi.stubGlobal('ImageData', FakeImageData)
  vi.stubGlobal('document', {
    createElement(tag: string) {
      expect(tag).toBe('canvas')
      const canvas = new FakeCanvas()
      created.push(canvas)
      return canvas
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(): { renderer: SelectionOverlayRenderer; canvas: FakeCanvas } {
  const canvas = new FakeCanvas()
  const renderer = createSelectionOverlayRenderer(canvas as unknown as HTMLCanvasElement)
  if (!renderer) throw new Error('no renderer')
  return { renderer, canvas }
}

/** A deterministic random mask with about `density` of its pixels selected. */
function randomMask(width: number, height: number, density: number, seed: number): SelectionMask {
  let state = seed
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    data[i] = state / 2 ** 32 < density ? 1 : 0
  }
  data[0] = 1
  return createSelectionMask(width, height, data)!
}

/** A background selection with disconnected islands and holes, like a screenshot's. */
function screenshotMask(width: number, height: number): SelectionMask {
  const data = new Uint8Array(width * height).fill(1)
  const hole = (x: number, y: number, w: number, h: number, value = 0) => {
    for (let j = y; j < y + h; j++) data.fill(value, j * width + x, j * width + x + w)
  }
  hole(10, 10, Math.floor(width / 2), Math.floor(height / 2))
  hole(20, 20, 15, 12, 1) // an island inside the hole
  for (let i = 0; i < 40; i++) hole(5 + ((i * 37) % (width - 12)), Math.floor(height * 0.7) + (i % 5) * 4, 3, 2) // text-like holes
  return createSelectionMask(width, height, data)!
}

function plan(selection: SelectionMask, zoom: number, offset: { x: number; y: number }, devicePixelRatio: number, viewportSize: Size) {
  const viewport = snapToDevicePixels({ zoom, offset }, devicePixelRatio)
  return planSelectionOverlay({ selection, viewport, viewportSize, devicePixelRatio })
}

/** The backing store a fresh render of `overlay` in `pattern` must produce. */
function expectedFrame(selection: SelectionMask, overlay: SelectionOverlayPlan, pattern: BoundaryPattern): Uint32Array {
  const { backingStore, origin } = overlay
  const frame = new Uint32Array(backingStore.width * backingStore.height)
  for (const { rect } of overlay.tiles) {
    const tile = new Uint32Array(rect.width * rect.height)
    if (!rasteriseSelectionOverlay(selection, overlay.scale, overlay.lineWidth, rect, tile, rect.width, pattern)) continue
    for (let r = 0; r < rect.height; r++) {
      const y = origin.y + rect.y + r
      if (y < 0 || y >= backingStore.height) continue
      for (let c = 0; c < rect.width; c++) {
        const x = origin.x + rect.x + c
        if (x >= 0 && x < backingStore.width) frame[y * backingStore.width + x] = tile[r * rect.width + c]
      }
    }
  }
  return frame
}

function expectFrame(canvas: FakeCanvas, expected: Uint32Array, label: string) {
  expect(canvas.pixels.length, label).toBe(expected.length)
  const mismatch = canvas.pixels.findIndex((pixel, i) => pixel !== expected[i])
  expect(mismatch, `${label}: first difference at ${mismatch % canvas.width}, ${Math.floor(mismatch / canvas.width)}`).toBe(-1)
  expect(canvas.context.overlaps, `${label}: tint drawn twice`).toBe(0)
}

/** The GPU process dies: every canvas loses its context and nothing drawn reaches it. */
function loseContexts() {
  gpu.lost = true
}

/**
 * The GPU process is back: every canvas comes back blank, the tiles first and the overlay canvas
 * last, as measured in Chrome 156.
 */
function restoreContexts(canvas: FakeCanvas) {
  gpu.lost = false
  for (const tile of created) tile.blank()
  canvas.blank()
  for (const tile of created) tile.fire('contextrestored')
  canvas.fire('contextrestored')
}

/** `frame`, which must show something: a frame with nothing to see would prove nothing. */
function shown(frame: Uint32Array): Uint32Array {
  expect(frame.some((pixel) => alpha(pixel) !== 0)).toBe(true)
  return frame
}

/** How many tiles of `overlay` have something to draw, so get a canvas. */
function drawnTiles(selection: SelectionMask, overlay: SelectionOverlayPlan): number {
  const out = new Uint32Array(256 * 256)
  return overlay.tiles.filter(({ rect }) => rasteriseOverlayTile(selection, overlay.scale, overlay.lineWidth, rect, out, 256, STATIC_BOUNDARY).drawn).length
}

const totalCalls = () =>
  created.reduce((sum, canvas) => sum + canvas.context.calls.putImageData + canvas.context.calls.drawImage + canvas.context.calls.clearRect, 0)

describe('selection overlay renderer: marching ants', () => {
  it('shows exactly a fresh render of each phase after every step, at any zoom, pan and display scaling', () => {
    const selection = screenshotMask(160, 110)
    const configurations: [zoom: number, dpr: number, offset: { x: number; y: number }][] = [
      [0.25, 1, { x: 7.3, y: 5.1 }],
      [1, 1, { x: 3, y: 4 }],
      [1.5, 1, { x: -20.4, y: 9.7 }],
      [2, 1.25, { x: -61.3, y: -11.9 }],
      [1, 1.5, { x: 10.2, y: 3.3 }],
      [8, 2, { x: -150.6, y: -40.2 }],
      [32, 1, { x: -4000.4, y: -2000.7 }],
      [1.234, 1.25, { x: 13.6, y: -9.2 }],
    ]
    for (const [zoom, dpr, offset] of configurations) {
      const { renderer, canvas } = setup()
      const overlay = plan(selection, zoom, offset, dpr, { width: 300, height: 200 })
      renderer.render(overlay, selection, marchingBoundary(0))
      const label = `zoom ${zoom}, dpr ${dpr}`
      expectFrame(canvas, expectedFrame(selection, overlay, marchingBoundary(0)), `${label}, first frame`)
      for (let step = 1; step <= MARCHING_ANTS_PHASES + 1; step++) {
        renderer.setPattern(marchingBoundary(step))
        expectFrame(canvas, expectedFrame(selection, overlay, marchingBoundary(step)), `${label}, step ${step}`)
      }
      // Reduced motion switched on: the static checkerboard.
      renderer.setPattern(STATIC_BOUNDARY)
      expectFrame(canvas, expectedFrame(selection, overlay, STATIC_BOUNDARY), `${label}, static`)
      renderer.dispose()
    }
  })

  it('never rasterises again or reads the selection for a step', () => {
    const base = screenshotMask(400, 300)
    let reads = 0
    const selection = Object.defineProperty({ width: base.width, height: base.height, count: base.count, bounds: base.bounds }, 'data', {
      get() {
        reads++
        return base.data
      },
    }) as SelectionMask
    const { renderer } = setup()
    renderer.render(plan(selection, 1, { x: 0, y: 0 }, 1, { width: 380, height: 280 }), selection, marchingBoundary(0))
    const tilesCreated = created.length
    const readsAfterRender = reads
    expect(readsAfterRender).toBeGreaterThan(0)
    for (let step = 1; step <= 20; step++) renderer.setPattern(marchingBoundary(step))
    expect(reads).toBe(readsAfterRender)
    expect(created.length).toBe(tilesCreated)
  })

  it('repaints only visible tiles that have a boundary: one upload and one copy each per step', () => {
    // At 400% the view holds tiles inside the selection (tint only) and tiles on its edge.
    const selection = selectAll(200, 200)
    const { renderer, canvas } = setup()
    const overlay = plan(selection, 4, { x: -100, y: -100 }, 1, { width: 600, height: 400 })
    renderer.render(overlay, selection, marchingBoundary(0))
    const out = new Uint32Array(256 * 256)
    const withBoundary = overlay.tiles.filter(
      ({ rect }) => rasteriseOverlayTile(selection, overlay.scale, overlay.lineWidth, rect, out, 256, STATIC_BOUNDARY).boundary,
    ).length
    expect(withBoundary).toBeGreaterThan(0)
    expect(withBoundary).toBeLessThan(overlay.tiles.length)
    const before = { tiles: totalCalls(), canvas: { ...canvas.context.calls } }
    renderer.setPattern(marchingBoundary(1))
    const tileCalls = totalCalls() - before.tiles
    expect(tileCalls).toBe(withBoundary) // putImageData into each boundary tile
    expect(canvas.context.calls.drawImage - before.canvas.drawImage).toBe(withBoundary)
    expect(canvas.context.calls.clearRect - before.canvas.clearRect).toBe(withBoundary)
    expect(canvas.context.calls.putImageData).toBe(0)
  })

  it('does nothing for a step when no boundary is in view', () => {
    const selection = selectAll(400, 400)
    const { renderer, canvas } = setup()
    // At 800% in the middle of the image, only tint is visible.
    renderer.render(plan(selection, 8, { x: -1500, y: -1500 }, 1, { width: 300, height: 200 }), selection, marchingBoundary(0))
    expect(renderer.visibleBoundaryArea()).toBe(0)
    const pixels = canvas.pixels.slice()
    const calls = totalCalls() + canvas.context.calls.drawImage + canvas.context.calls.clearRect
    renderer.setPattern(marchingBoundary(1))
    expect(totalCalls() + canvas.context.calls.drawImage + canvas.context.calls.clearRect).toBe(calls)
    expect(canvas.pixels).toEqual(pixels)
  })

  it('reports the boundary area of the visible tiles, and none without a selection', () => {
    const selection = screenshotMask(300, 200)
    const { renderer } = setup()
    expect(renderer.visibleBoundaryArea()).toBe(0)
    const overlay = plan(selection, 1, { x: 0, y: 0 }, 1, { width: 300, height: 200 })
    renderer.render(overlay, selection, marchingBoundary(0))
    const out = new Uint32Array(256 * 256)
    let area = 0
    for (const { rect } of overlay.tiles) {
      const { boundary } = rasteriseOverlayTile(selection, overlay.scale, overlay.lineWidth, rect, out, 256, STATIC_BOUNDARY)
      if (boundary) area += boundary.area.width * boundary.area.height
    }
    expect(renderer.visibleBoundaryArea()).toBe(area)
    expect(area).toBeGreaterThan(0)
    renderer.render(null, null, marchingBoundary(0))
    expect(renderer.visibleBoundaryArea()).toBe(0)
  })

  it('brings tiles kept out of view up to date when they come back', () => {
    const selection = screenshotMask(1200, 900)
    const { renderer, canvas } = setup()
    const size = { width: 400, height: 300 }
    const home = plan(selection, 1, { x: 0, y: 0 }, 1, size)
    renderer.render(home, selection, marchingBoundary(0))
    renderer.setPattern(marchingBoundary(1))
    renderer.setPattern(marchingBoundary(2))
    // Pan away by less than the kept margin, step, and pan back.
    const away = plan(selection, 1, { x: -300, y: -200 }, 1, size)
    renderer.render(away, selection, marchingBoundary(2))
    renderer.setPattern(marchingBoundary(3))
    renderer.setPattern(marchingBoundary(4))
    const tiles = created.length
    renderer.render(plan(selection, 1, { x: 0, y: 0 }, 1, size), selection, marchingBoundary(4))
    expect(created.length).toBe(tiles) // reused, not rasterised again
    expectFrame(canvas, expectedFrame(selection, home, marchingBoundary(4)), 'after panning back')
  })

  it('draws new tiles in the current phase while panning', () => {
    const selection = screenshotMask(900, 700)
    const { renderer, canvas } = setup()
    const size = { width: 300, height: 200 }
    renderer.render(plan(selection, 1.5, { x: 0, y: 0 }, 1, size), selection, marchingBoundary(0))
    for (let step = 1; step <= 5; step++) {
      renderer.setPattern(marchingBoundary(step))
      const overlay = plan(selection, 1.5, { x: -97.3 * step, y: -61.1 * step }, 1, size)
      renderer.render(overlay, selection, marchingBoundary(step))
      expectFrame(canvas, expectedFrame(selection, overlay, marchingBoundary(step)), `pan ${step}`)
    }
  })

  it('releases every tile, its boundary pixels and the backing store when the selection is cleared', () => {
    const selection = screenshotMask(500, 400)
    const { renderer, canvas } = setup()
    renderer.render(plan(selection, 1, { x: 0, y: 0 }, 1, { width: 500, height: 400 }), selection, marchingBoundary(0))
    renderer.setPattern(marchingBoundary(1))
    expect(created.length).toBeGreaterThan(0)
    renderer.render(null, null, marchingBoundary(1))
    expect(created.every((tile) => tile.width === 0 && tile.height === 0)).toBe(true)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    const calls = totalCalls()
    renderer.setPattern(marchingBoundary(2))
    expect(totalCalls()).toBe(calls)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
  })

  it('replaces the old image’s tiles when another image and selection are shown', () => {
    const first = screenshotMask(500, 400)
    const { renderer, canvas } = setup()
    renderer.render(plan(first, 1, { x: 0, y: 0 }, 1, { width: 400, height: 300 }), first, marchingBoundary(0))
    renderer.setPattern(marchingBoundary(1))
    const oldTiles = [...created]
    // A new image: its selection has another size and no tile in common with the old one.
    const second = randomMask(90, 70, 0.3, 77)
    const overlay = plan(second, 2, { x: 11, y: 7 }, 1, { width: 400, height: 300 })
    renderer.render(overlay, second, marchingBoundary(1))
    expect(oldTiles.every((tile) => tile.width === 0 && tile.height === 0)).toBe(true)
    const oldCalls = oldTiles.map((tile) => ({ ...tile.context.calls }))
    renderer.setPattern(marchingBoundary(2))
    expect(oldTiles.map((tile) => tile.context.calls)).toEqual(oldCalls)
    expectFrame(canvas, expectedFrame(second, overlay, marchingBoundary(2)), 'new image')
  })

  it('ignores a pattern it already shows', () => {
    const selection = screenshotMask(300, 200)
    const { renderer, canvas } = setup()
    const overlay = plan(selection, 1, { x: 0, y: 0 }, 1, { width: 300, height: 200 })
    renderer.render(overlay, selection, marchingBoundary(3))
    const calls = totalCalls() + canvas.context.calls.drawImage
    renderer.setPattern(marchingBoundary(3))
    renderer.render(overlay, selection, marchingBoundary(3))
    expect(totalCalls() + canvas.context.calls.drawImage).toBe(calls)
  })

  it('handles a million disconnected pixels with one upload and one copy per tile and step', () => {
    const width = 2048
    const height = 1024
    const data = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = y & 1; x < width; x += 2) data[y * width + x] = 1
    const selection = createSelectionMask(width, height, data)!
    expect(selection.count).toBe(1_048_576)
    const { renderer, canvas } = setup()
    const overlay = plan(selection, 1, { x: 0, y: 0 }, 1, { width: 1920, height: 1080 })
    renderer.render(overlay, selection, marchingBoundary(0))
    for (let step = 1; step <= 2; step++) {
      const before = { tiles: totalCalls(), drawImage: canvas.context.calls.drawImage }
      renderer.setPattern(marchingBoundary(step))
      expect(totalCalls() - before.tiles).toBe(overlay.tiles.length)
      expect(canvas.context.calls.drawImage - before.drawImage).toBe(overlay.tiles.length)
    }
    expect(overlay.tiles.length).toBeLessThanOrEqual(40)
    expectFrame(canvas, expectedFrame(selection, overlay, marchingBoundary(2)), 'checkerboard')
  })
})

describe('selection overlay renderer: context restoration', () => {
  it('draws the tint and boundary again as soon as its context is restored, at any zoom, pan and display scaling', () => {
    const selection = screenshotMask(160, 110)
    const before = selection.data.slice()
    const configurations: [zoom: number, dpr: number, offset: { x: number; y: number }][] = [
      [0.25, 1, { x: 7.3, y: 5.1 }],
      [1, 1, { x: 3, y: 4 }],
      [1.5, 1, { x: -20.4, y: 9.7 }],
      [2, 1.25, { x: -61.3, y: -11.9 }],
      [1, 1.5, { x: 10.2, y: 3.3 }],
      [8, 2, { x: -150.6, y: -40.2 }],
      [1.234, 1.25, { x: 13.6, y: -9.2 }],
    ]
    for (const [zoom, dpr, offset] of configurations) {
      for (const steps of [0, 3]) {
        const { renderer, canvas } = setup()
        const overlay = plan(selection, zoom, offset, dpr, { width: 300, height: 200 })
        const label = `zoom ${zoom}, dpr ${dpr}, ${steps ? 'marching' : 'static'}`
        renderer.render(overlay, selection, steps ? marchingBoundary(0) : STATIC_BOUNDARY)
        for (let step = 1; step <= steps; step++) renderer.setPattern(marchingBoundary(step))
        const pattern = steps ? marchingBoundary(steps) : STATIC_BOUNDARY
        loseContexts()
        restoreContexts(canvas)
        expectFrame(canvas, shown(expectedFrame(selection, overlay, pattern)), label)
        renderer.dispose()
      }
    }
    expect(selection.data).toEqual(before)
  })

  it('never draws the blank tiles again: marching-ants steps and pans after restoration show the whole overlay', () => {
    // Before restoration was handled, steps brought back only the boundary areas and a pan
    // reused the blank tiles; only a zoom change, which rasterises every tile again, recovered.
    const selection = screenshotMask(900, 700)
    const { renderer, canvas } = setup()
    const size = { width: 400, height: 300 }
    renderer.render(plan(selection, 1.5, { x: 0, y: 0 }, 1, size), selection, marchingBoundary(0))
    renderer.setPattern(marchingBoundary(1))
    const oldTiles = [...created]
    loseContexts()
    restoreContexts(canvas)
    expect(oldTiles.every((tile) => tile.width === 0 && tile.height === 0)).toBe(true)
    const oldCalls = oldTiles.map((tile) => ({ ...tile.context.calls }))

    renderer.setPattern(marchingBoundary(2))
    expectFrame(canvas, shown(expectedFrame(selection, plan(selection, 1.5, { x: 0, y: 0 }, 1, size), marchingBoundary(2))), 'step')
    for (const [k, offset] of [{ x: -40, y: -25 }, { x: -5.3, y: -13.1 }, { x: 0, y: 0 }].entries()) {
      const overlay = plan(selection, 1.5, offset, 1, size)
      renderer.render(overlay, selection, marchingBoundary(3 + k))
      expectFrame(canvas, shown(expectedFrame(selection, overlay, marchingBoundary(3 + k))), `pan ${k}`)
    }
    expect(oldTiles.map((tile) => tile.context.calls)).toEqual(oldCalls)
  })

  it('draws the latest frame when frames were asked for while the context was lost', () => {
    const selection = screenshotMask(500, 400)
    const { renderer, canvas } = setup()
    const size = { width: 300, height: 200 }
    renderer.render(plan(selection, 1, { x: 0, y: 0 }, 1, size), selection, marchingBoundary(0))
    loseContexts()
    renderer.render(plan(selection, 1, { x: -50, y: -30 }, 1, size), selection, marchingBoundary(0))
    // Another zoom: its tiles are created while the context is lost.
    const latest = plan(selection, 2, { x: -10.5, y: -6.25 }, 1, size)
    renderer.render(latest, selection, marchingBoundary(0))
    renderer.setPattern(marchingBoundary(5))
    restoreContexts(canvas)
    expectFrame(canvas, shown(expectedFrame(selection, latest, marchingBoundary(5))), 'latest frame')
  })

  it('draws once per restoration, rasterising only the visible tiles', () => {
    const selection = screenshotMask(1200, 900)
    const { renderer, canvas } = setup()
    const overlay = plan(selection, 1, { x: -100, y: -60 }, 1, { width: 500, height: 400 })
    renderer.render(overlay, selection, STATIC_BOUNDARY)
    // Tiles kept just out of view after panning back are dropped too, not rasterised.
    renderer.render(plan(selection, 1, { x: -300, y: -200 }, 1, { width: 500, height: 400 }), selection, STATIC_BOUNDARY)
    renderer.render(overlay, selection, STATIC_BOUNDARY)
    const visible = drawnTiles(selection, overlay)
    expect(created.length).toBeGreaterThan(visible)
    for (let restoration = 1; restoration <= 2; restoration++) {
      const tilesBefore = created.length
      const drawsBefore = canvas.context.calls.drawImage
      loseContexts()
      restoreContexts(canvas)
      expect(created.length - tilesBefore).toBe(visible)
      expect(canvas.context.calls.drawImage - drawsBefore).toBe(visible)
      expectFrame(canvas, shown(expectedFrame(selection, overlay, STATIC_BOUNDARY)), `restoration ${restoration}`)
    }
  })

  it('stays static with reduced motion, and schedules no marching-ants step', () => {
    const selection = screenshotMask(300, 200)
    const { renderer, canvas } = setup()
    let scheduled = 0
    const clock: AnimationClock = {
      now: () => 0,
      setTimeout: () => ++scheduled,
      clearTimeout() {},
      requestAnimationFrame: () => ++scheduled,
      cancelAnimationFrame() {},
    }
    const ants = createMarchingAnts(renderer, clock, { reducedMotion: true, hidden: false })
    const overlay = plan(selection, 1, { x: 0, y: 0 }, 1, { width: 300, height: 200 })
    renderer.render(overlay, selection, ants.pattern())
    ants.update()
    loseContexts()
    restoreContexts(canvas)
    expectFrame(canvas, shown(expectedFrame(selection, overlay, STATIC_BOUNDARY)), 'static after restoration')
    expect(scheduled).toBe(0)
    ants.dispose()
  })

  it('does nothing when restored with nothing selected, or after it was disposed', () => {
    const { renderer, canvas } = setup()
    renderer.render(null, null, STATIC_BOUNDARY)
    restoreContexts(canvas)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    expect(created).toHaveLength(0)

    const selection = screenshotMask(300, 200)
    renderer.render(plan(selection, 1, { x: 0, y: 0 }, 1, { width: 300, height: 200 }), selection, STATIC_BOUNDARY)
    const tiles = created.length
    renderer.dispose()
    expect(canvas.listeners.get('contextrestored')?.size ?? 0).toBe(0)
    restoreContexts(canvas)
    expect(created).toHaveLength(tiles)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
  })
})
