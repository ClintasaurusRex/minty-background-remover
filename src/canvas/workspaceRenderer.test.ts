import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planFrame } from './rendering'
import { createWorkspaceRenderer } from './workspaceRenderer'

/*
 * The renderer against a fake canvas that counts drawing calls: frames identical to the last
 * one drawn are skipped, anything else is drawn.
 */

class FakeContext {
  readonly calls = { clearRect: 0, fillRect: 0, drawImage: 0 }
  fillStyle: unknown = null
  imageSmoothingEnabled = true
  imageSmoothingQuality = 'low'
  setTransform() {}
  clearRect() {
    this.calls.clearRect++
  }
  fillRect() {
    this.calls.fillRect++
  }
  drawImage() {
    this.calls.drawImage++
  }
  createPattern() {
    return { setTransform() {} }
  }
}

class FakeCanvas {
  width = 0
  height = 0
  readonly context = new FakeContext()
  getContext() {
    return this.context
  }
}

const bitmap = (): ImageBitmap => ({ width: 400, height: 200, close() {} }) as ImageBitmap
const plan = (x: number, zoom = 1) =>
  planFrame({
    imageSize: { width: 400, height: 200 },
    viewport: { zoom, offset: { x, y: 100 } },
    viewportSize: { width: 1000, height: 600 },
    devicePixelRatio: 1,
  })

describe('createWorkspaceRenderer', () => {
  beforeEach(() => {
    // The checkerboard tile is a canvas of its own; DOMMatrix positions the pattern.
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() })
    vi.stubGlobal('DOMMatrix', class {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    const canvas = new FakeCanvas()
    const renderer = createWorkspaceRenderer(canvas as unknown as HTMLCanvasElement)!
    return { canvas, renderer, calls: canvas.context.calls }
  }

  it('skips a frame identical to the last one drawn', () => {
    const { renderer, calls, canvas } = setup()
    const image = bitmap()
    renderer.render(plan(300), image)
    expect(calls).toEqual({ clearRect: 1, fillRect: 1, drawImage: 1 })
    expect([canvas.width, canvas.height]).toEqual([1000, 600])
    // A new plan object for the same view, as every React render makes.
    renderer.render(plan(300), image)
    renderer.render(plan(300), image)
    expect(calls).toEqual({ clearRect: 1, fillRect: 1, drawImage: 1 })
  })

  it('draws again when the view or the image changes', () => {
    const { renderer, calls } = setup()
    const image = bitmap()
    renderer.render(plan(300), image)
    renderer.render(plan(301), image)
    expect(calls.drawImage).toBe(2)
    renderer.render(plan(301, 0.5), image)
    expect(calls.drawImage).toBe(3)
    renderer.render(plan(301, 0.5), bitmap())
    expect(calls.drawImage).toBe(4)
    // Back to a frame drawn earlier, but not the last one.
    renderer.render(plan(300), image)
    expect(calls.drawImage).toBe(5)
  })

  it('clears once when there is no image, and draws when one arrives', () => {
    const { renderer, calls } = setup()
    renderer.render(plan(300), null)
    renderer.render(plan(300), null)
    expect(calls).toEqual({ clearRect: 1, fillRect: 0, drawImage: 0 })
    renderer.render(plan(300), bitmap())
    expect(calls).toEqual({ clearRect: 2, fillRect: 1, drawImage: 1 })
  })

  it('draws the first frame of a renderer created after another was disposed', () => {
    const first = setup()
    const image = bitmap()
    first.renderer.render(plan(300), image)
    first.renderer.dispose()
    expect([first.canvas.width, first.canvas.height]).toEqual([0, 0])
    // React Strict Mode disposes and recreates the renderer on the same canvas.
    const second = createWorkspaceRenderer(first.canvas as unknown as HTMLCanvasElement)!
    second.render(plan(300), image)
    expect(first.calls.drawImage).toBe(2)
    expect([first.canvas.width, first.canvas.height]).toEqual([1000, 600])
  })
})
