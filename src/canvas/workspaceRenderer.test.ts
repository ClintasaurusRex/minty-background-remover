import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewportState } from '../editor/types'
import { imageDrawBias, snapToDevicePixels } from './devicePixels'
import { type DisplayImage, createDisplayImageOwner, displayContentKey, releaseDisplayImage } from './displayImage'
import { type FramePlan, planFrame } from './rendering'
import { type DisplayContent, createWorkspaceRenderer } from './workspaceRenderer'

/*
 * The renderer against a fake canvas that records drawing calls: frames identical to the last
 * one drawn are skipped, anything else is drawn, and a restored context is drawn again.
 */

type Call = readonly [name: string, ...args: unknown[]]

class FakeContext {
  readonly calls = { clearRect: 0, fillRect: 0, drawImage: 0, createPattern: 0 }
  /** Every setTransform, fillRect and drawImage, with its arguments. */
  readonly log: Call[] = []
  /** The pattern transforms set, as DOMMatrix initialisers. */
  readonly patternOrigins: unknown[] = []
  fillStyle: unknown = null
  imageSmoothingEnabled = true
  imageSmoothingQuality = 'low'
  /** Makes drawImage throw, like the browser does for a released image. */
  failDraw = false
  setTransform(...args: number[]) {
    this.log.push(['setTransform', ...args])
  }
  clearRect() {
    this.calls.clearRect++
  }
  fillRect(...args: number[]) {
    this.calls.fillRect++
    this.log.push(['fillRect', ...args])
  }
  drawImage(image: DisplayImage, ...args: number[]) {
    if (this.failDraw || image.width === 0) throw new DOMException('The image source is detached', 'InvalidStateError')
    this.calls.drawImage++
    this.log.push(['drawImage', image, ...args, this.imageSmoothingEnabled])
  }
  createPattern() {
    this.calls.createPattern++
    return { setTransform: (matrix: { init: unknown }) => this.patternOrigins.push(matrix.init) }
  }
}

class FakeCanvas {
  width = 0
  height = 0
  readonly context = new FakeContext()
  readonly listeners = new Map<string, Set<(event: Event) => void>>()
  getContext() {
    return this.context
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }
  /** Fires an event as the browser would; returns whether a listener cancelled it. */
  fire(type: 'contextlost' | 'contextrestored'): boolean {
    let cancelled = false
    const event = { type, cancelable: type === 'contextlost', preventDefault: () => (cancelled = true) } as unknown as Event
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return cancelled
  }
}

/** The transform each image was drawn with: the last setTransform before each drawImage. */
function imageTransforms(context: FakeContext): unknown[][] {
  const transforms: unknown[][] = []
  let current: unknown[] = []
  for (const [name, ...args] of context.log) {
    if (name === 'setTransform') current = args
    if (name === 'drawImage') transforms.push(current)
  }
  return transforms
}

const bitmap = (): ImageBitmap => {
  const image = { width: 400, height: 200, close: () => (image.width = image.height = 0) }
  return image as unknown as ImageBitmap
}
const content = (image: DisplayImage, revision = 0, id = 1): DisplayContent => ({ image, key: displayContentKey({ id, revision }) })
const plan = (x: number, zoom = 1, { devicePixelRatio = 1, width = 1000, height = 600 } = {}): FramePlan => {
  const viewport: ViewportState = { zoom, offset: { x, y: 100 } }
  return planFrame({
    imageSize: { width: 400, height: 200 },
    viewport: snapToDevicePixels(viewport, devicePixelRatio),
    viewportSize: { width, height },
    devicePixelRatio,
  })
}

describe('createWorkspaceRenderer', () => {
  beforeEach(() => {
    // The checkerboard tile is a canvas of its own; DOMMatrix positions the pattern.
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() })
    vi.stubGlobal(
      'DOMMatrix',
      class {
        readonly init: unknown
        constructor(init: unknown) {
          this.init = init
        }
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    const canvas = new FakeCanvas()
    const renderer = createWorkspaceRenderer(canvas as unknown as HTMLCanvasElement)!
    return { canvas, renderer, calls: canvas.context.calls, context: canvas.context }
  }

  describe('skipping frames', () => {
    it('skips a frame identical to the last one drawn', () => {
      const { renderer, calls, canvas } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      expect(calls).toEqual({ clearRect: 1, fillRect: 1, drawImage: 1, createPattern: 1 })
      expect([canvas.width, canvas.height]).toEqual([1000, 600])
      // New plan and content objects for the same view and content, as every React render makes.
      renderer.render(plan(300), content(image))
      renderer.render(plan(300), content(image))
      expect(calls).toEqual({ clearRect: 1, fillRect: 1, drawImage: 1, createPattern: 1 })
    })

    it('draws again when the content key changes, even with the same image', () => {
      const { renderer, calls } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image, 0))
      renderer.render(plan(300), content(image, 4))
      expect(calls.drawImage).toBe(2)
      renderer.render(plan(300), content(image, 4))
      expect(calls.drawImage).toBe(2)
      // Another document with the same revision.
      renderer.render(plan(300), content(image, 4, 2))
      expect(calls.drawImage).toBe(3)
    })

    it('draws again when the display image changes, even with the same content key', () => {
      const { renderer, calls, context } = setup()
      const [first, second] = [bitmap(), bitmap()]
      renderer.render(plan(300), content(first, 3))
      renderer.render(plan(300), content(second, 3))
      expect(calls.drawImage).toBe(2)
      expect(context.log.filter(([name]) => name === 'drawImage').map(([, image]) => image)).toEqual([first, second])
    })

    it('draws again when the view changes: pan, zoom, workspace size, device pixel ratio', () => {
      const { renderer, calls } = setup()
      const image = bitmap()
      const views = [
        plan(300),
        plan(301),
        plan(301, 0.5),
        plan(301, 4),
        plan(301, 4, { width: 900 }),
        plan(301, 4, { width: 900, devicePixelRatio: 2 }),
        plan(301, 4, { width: 900, devicePixelRatio: 1.5 }),
        // Back to a frame drawn earlier, but not the last one.
        plan(300),
      ]
      for (const view of views) renderer.render(view, content(image))
      expect(calls.drawImage).toBe(views.length)
    })

    it('clears once when there is no content, and draws when content arrives', () => {
      const { renderer, calls } = setup()
      renderer.render(plan(300), null)
      renderer.render(plan(300), null)
      expect(calls).toEqual({ clearRect: 1, fillRect: 0, drawImage: 0, createPattern: 0 })
      renderer.render(plan(300), content(bitmap()))
      expect(calls).toMatchObject({ clearRect: 2, fillRect: 1, drawImage: 1 })
      renderer.render(plan(300), null)
      expect(calls).toMatchObject({ clearRect: 3, drawImage: 1 })
    })
  })

  describe('invalidate', () => {
    it('makes the next render draw even an identical frame, and only that one', () => {
      const { renderer, calls } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      renderer.invalidate()
      // Invalidating draws nothing by itself.
      expect(calls.drawImage).toBe(1)
      renderer.render(plan(300), content(image))
      expect(calls.drawImage).toBe(2)
      renderer.render(plan(300), content(image))
      expect(calls.drawImage).toBe(2)
    })

    it('makes the checkerboard pattern again', () => {
      const { renderer, calls } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      renderer.render(plan(310), content(image))
      expect(calls.createPattern).toBe(1)
      renderer.invalidate()
      renderer.render(plan(310), content(image))
      expect(calls.createPattern).toBe(2)
    })

    it('draws again after a frame that failed to draw', () => {
      const { renderer, calls, context } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      context.failDraw = true
      expect(() => renderer.render(plan(301), content(image))).toThrow()
      context.failDraw = false
      renderer.render(plan(301), content(image))
      expect(calls.drawImage).toBe(2)
    })
  })

  describe('context loss and restoration', () => {
    it('draws the last frame again as soon as the context is restored', () => {
      const { renderer, calls, context, canvas } = setup()
      const image = bitmap()
      renderer.render(plan(300, 2), content(image))
      const drawn = context.log.slice()
      context.log.length = 0
      expect(canvas.fire('contextlost')).toBe(false)
      expect(calls.drawImage).toBe(1)
      // The browser restores the context blank and reset; nothing else happens in the app.
      expect(canvas.fire('contextrestored')).toBe(false)
      expect(calls).toEqual({ clearRect: 2, fillRect: 2, drawImage: 2, createPattern: 2 })
      expect(context.log).toEqual(drawn)
      // That frame is now shown: an identical render is skipped again.
      renderer.render(plan(300, 2), content(image))
      expect(calls.drawImage).toBe(2)
    })

    it('draws the latest frame asked for, including frames asked for while the context was lost', () => {
      const { renderer, context, canvas } = setup()
      const [first, second] = [bitmap(), bitmap()]
      renderer.render(plan(300), content(first, 0))
      canvas.fire('contextlost')
      // Drawing into a lost context does nothing in the browser; the frame is remembered.
      renderer.render(plan(320), content(second, 5))
      context.log.length = 0
      canvas.fire('contextrestored')
      expect(context.log.filter(([name]) => name === 'drawImage').map(([, image]) => image)).toEqual([second])
      // Placed where the latest frame puts it.
      // (Scale 1, a whole number: drawn on its corner; imageDrawBias, devicePixels.ts.)
      expect(imageTransforms(context)).toEqual([[1, 0, 0, 1, 320, 100]])
    })

    it('only clears after a restoration when there is no content, and draws nothing before the first frame', () => {
      const { renderer, calls, canvas } = setup()
      canvas.fire('contextrestored')
      expect(calls).toEqual({ clearRect: 0, fillRect: 0, drawImage: 0, createPattern: 0 })
      renderer.render(plan(300), null)
      canvas.fire('contextrestored')
      expect(calls).toEqual({ clearRect: 2, fillRect: 0, drawImage: 0, createPattern: 0 })
    })

    it('stops listening once disposed', () => {
      const { renderer, calls, canvas } = setup()
      renderer.render(plan(300), content(bitmap()))
      renderer.dispose()
      expect(canvas.listeners.get('contextrestored')?.size).toBe(0)
      canvas.fire('contextrestored')
      expect(calls.drawImage).toBe(1)
    })
  })

  describe('display image ownership', () => {
    it('never draws a released image: it clears the canvas instead of throwing', () => {
      const { renderer, calls } = setup()
      const released = bitmap()
      releaseDisplayImage(released)
      expect(() => renderer.render(plan(300), content(released))).not.toThrow()
      expect(calls).toMatchObject({ clearRect: 1, drawImage: 0 })
      renderer.render(plan(300), content(bitmap(), 1))
      expect(calls.drawImage).toBe(1)
    })

    it('does not draw a frame again after its image was released, even when the context is restored', () => {
      const { renderer, calls, canvas } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      releaseDisplayImage(image)
      expect(() => canvas.fire('contextrestored')).not.toThrow()
      expect(calls).toMatchObject({ clearRect: 2, drawImage: 1 })
    })

    it('never releases images itself, also when disposed', () => {
      const { renderer } = setup()
      const image = bitmap()
      renderer.render(plan(300), content(image))
      renderer.render(plan(300), content(bitmap(), 1))
      renderer.dispose()
      expect(image.width).toBe(400)
    })

    it('replaces and releases images safely, the workspace canvas way: draw the new image, then release the old one', () => {
      const { renderer, calls, canvas } = setup()
      const owner = createDisplayImageOwner()
      const images = [bitmap(), bitmap(), bitmap()]
      images.forEach((image, revision) => {
        renderer.render(plan(300), content(image, revision))
        owner.show(image)
        // A context restoration at any point draws the image now shown, never a released one.
        canvas.fire('contextrestored')
      })
      expect(calls.drawImage).toBe(6)
      expect(images.map((image) => image.width)).toEqual([0, 0, 400])
    })

    it('survives React Strict Mode: dispose and re-create on the same canvas, then draw the same image again', () => {
      const first = setup()
      const owner = createDisplayImageOwner()
      const image = bitmap()
      first.renderer.render(plan(300), content(image))
      owner.show(image)
      first.renderer.dispose()
      expect([first.canvas.width, first.canvas.height]).toEqual([0, 0])
      const second = createWorkspaceRenderer(first.canvas as unknown as HTMLCanvasElement)!
      second.render(plan(300), content(image))
      owner.show(image)
      expect(first.calls.drawImage).toBe(2)
      expect([first.canvas.width, first.canvas.height]).toEqual([1000, 600])
      expect(image.width).toBe(400)
      // Only the second renderer listens for restoration.
      expect(first.canvas.listeners.get('contextrestored')?.size).toBe(1)
    })
  })

  describe('device pixel alignment', () => {
    it('draws image pixel edges (the bias past them) and checkerboard squares on whole device pixels, however the frame is drawn', () => {
      for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
        for (const zoom of [0.25, 1, 2, 8]) {
          const { renderer, context, canvas } = setup()
          const image = bitmap()
          // An offset that is not on a device pixel until snapped.
          const frame = plan(123.37, zoom, { devicePixelRatio })
          renderer.render(frame, content(image))
          renderer.invalidate()
          renderer.render(frame, content(image, 1))
          canvas.fire('contextrestored')

          const transforms = imageTransforms(context)
          const draws = context.log.filter(([name]) => name === 'drawImage')
          expect(draws).toHaveLength(3)
          expect(transforms).toHaveLength(3)
          expect(transforms[1]).toEqual(transforms[0])
          expect(transforms[2]).toEqual(transforms[0])
          for (const [a, b, c, d, e, f] of transforms) {
            expect([a, b, c, d]).toEqual([zoom * devicePixelRatio, 0, 0, zoom * devicePixelRatio])
            const bias = imageDrawBias(a as number)
            expect(Number.isInteger((e as number) - bias) && Number.isInteger((f as number) - bias)).toBe(true)
          }
          for (const [, , sx, sy, sw, sh, dx, dy, dw, dh, smoothing] of draws) {
            expect([sx, sy, sw, sh].every(Number.isInteger)).toBe(true)
            expect([dx, dy, dw, dh]).toEqual([sx, sy, sw, sh])
            expect(smoothing).toBe(zoom < 1)
          }
          for (const origin of context.patternOrigins as number[][]) {
            expect(origin.slice(0, 4)).toEqual([1, 0, 0, 1])
            expect(origin.slice(4).every(Number.isInteger)).toBe(true)
          }
        }
      }
    })
  })
})
