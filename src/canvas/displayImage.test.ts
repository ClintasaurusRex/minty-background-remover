import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PixelBuffer } from '../editor/types'
import {
  type DisplayImage,
  createDisplayImage,
  createDisplayImageOwner,
  displayContentKey,
  isReleasedDisplayImage,
  releaseDisplayImage,
} from './displayImage'

/*
 * Display images against fake canvases that behave like the browser's where it matters here:
 * a canvas keeps its own copy of the pixels written with putImageData, transferToImageBitmap
 * hands that copy to a new bitmap and leaves the canvas a blank one, and closing a bitmap or
 * zero-sizing a canvas releases it. How real browsers round partially transparent pixels is
 * checked in Chrome and Firefox (IMPLEMENTATION_PLAN.md, Phase 3 Step 4).
 */

/** Stands in for the browser's ImageData, which Node lacks. */
class FakeImageData {
  readonly colorSpace = 'srgb'
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

interface Put {
  readonly imageData: ImageData
  readonly dx: number
  readonly dy: number
}

/** What the fakes are told to do, and what they recorded. */
const browser = {
  /** getContext('2d') returns null on this kind of canvas. */
  noContext: { offscreen: false, element: false },
  failPut: { offscreen: false, element: false },
  failTransfer: false,
  /** The bitmap transferToImageBitmap returns is this much narrower than the canvas. */
  shrinkBitmap: 0,
  canvases: [] as FakeCanvas[],
  bitmaps: [] as FakeBitmap[],
  puts: [] as Put[],
  contextOptions: [] as unknown[],
}

class FakeBitmap {
  width: number
  height: number
  /** The pixels as the bitmap holds them; null once closed. */
  pixels: Uint8ClampedArray | null
  closeCalls = 0

  constructor(width: number, height: number, pixels: Uint8ClampedArray) {
    this.width = width
    this.height = height
    this.pixels = pixels
    browser.bitmaps.push(this)
  }

  close() {
    this.closeCalls++
    this.width = this.height = 0
    this.pixels = null
  }
}

class FakeCanvas {
  readonly kind: 'offscreen' | 'element'
  private _width = 0
  private _height = 0
  /** The canvas's own pixels (straight RGBA in this fake; the browser's are premultiplied). */
  pixels = new Uint8ClampedArray(0)

  constructor(kind: 'offscreen' | 'element', width = 300, height = 150) {
    this.kind = kind
    this.width = width
    this.height = height
    browser.canvases.push(this)
  }

  get width() {
    return this._width
  }
  set width(value: number) {
    this._width = value
    this.pixels = new Uint8ClampedArray(this._width * this._height * 4)
  }
  get height() {
    return this._height
  }
  set height(value: number) {
    this._height = value
    this.pixels = new Uint8ClampedArray(this._width * this._height * 4)
  }

  getContext(type: string, options?: unknown) {
    expect(type).toBe('2d')
    browser.contextOptions.push(options)
    if (browser.noContext[this.kind]) return null
    return {
      putImageData: (imageData: ImageData, dx: number, dy: number) => {
        browser.puts.push({ imageData, dx, dy })
        if (browser.failPut[this.kind]) throw new Error('putImageData failed')
        this.pixels.set(imageData.data)
      },
    }
  }

  released() {
    return this.width === 0 && this.height === 0
  }
}

class FakeOffscreenCanvas extends FakeCanvas {
  constructor(width: number, height: number) {
    super('offscreen', width, height)
  }

  transferToImageBitmap() {
    if (browser.failTransfer) throw new DOMException('ImageBitmap construction failed', 'UnknownError')
    const bitmap = new FakeBitmap(this.width - browser.shrinkBitmap, this.height, this.pixels)
    // The canvas is left a new, blank bitmap of the same size.
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4)
    return bitmap
  }
}

/** An OffscreenCanvas from before transferToImageBitmap was available. */
class FakeOffscreenCanvasWithoutTransfer extends FakeCanvas {
  constructor(width: number, height: number) {
    super('offscreen', width, height)
  }
}

const fakeDocument = { createElement: (tag: string) => (expect(tag).toBe('canvas'), new FakeCanvas('element')) }

/** Every alpha value from 0 to 255 with varied colour, so hidden colour, partial alpha and misplaced bytes all show. */
function everyAlpha(width = 64, height = 8): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = (p * 37 + 11) & 255
    data[p * 4 + 1] = (p * 101 + 200) & 255
    data[p * 4 + 2] = (p * 7 + 99) & 255
    data[p * 4 + 3] = p & 255
  }
  return { width, height, data }
}

const bitmapOf = (image: DisplayImage) => image as unknown as FakeBitmap
const canvasOf = (image: DisplayImage) => image as unknown as FakeCanvas
const sameBytes = (a: Readonly<Uint8ClampedArray>, b: Readonly<Uint8ClampedArray>) =>
  a.length === b.length && a.every((value, i) => value === b[i])

beforeEach(() => {
  Object.assign(browser, {
    noContext: { offscreen: false, element: false },
    failPut: { offscreen: false, element: false },
    failTransfer: false,
    shrinkBitmap: 0,
    canvases: [],
    bitmaps: [],
    puts: [],
    contextOptions: [],
  })
  vi.stubGlobal('ImageData', FakeImageData)
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.stubGlobal('document', fakeDocument)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createDisplayImage with OffscreenCanvas and transferToImageBitmap', () => {
  it('creates a bitmap of the same size as the pixels', () => {
    for (const [width, height] of [[1, 1], [3, 2], [1, 7], [640, 3], [97, 61]]) {
      const image = createDisplayImage({ width, height, data: new Uint8ClampedArray(width * height * 4) })
      expect(image).toBeInstanceOf(FakeBitmap)
      expect([image.width, image.height]).toEqual([width, height])
    }
  })

  it('writes every byte once, at the origin, from the pixels themselves (no copy beforehand)', () => {
    const pixels = everyAlpha()
    createDisplayImage(pixels)
    expect(browser.puts).toHaveLength(1)
    const [{ imageData, dx, dy }] = browser.puts
    expect([dx, dy]).toEqual([0, 0])
    expect([imageData.width, imageData.height]).toEqual([64, 8])
    expect(imageData.data).toBe(pixels.data)
  })

  it('passes decoded ImageData to the canvas as it is', () => {
    const decoded = new ImageData(new Uint8ClampedArray(everyAlpha().data), 64, 8)
    createDisplayImage(decoded)
    expect(browser.puts[0].imageData).toBe(decoded)
  })

  it('holds exactly the opaque, transparent and partially transparent pixels written, in its own memory', () => {
    const pixels = everyAlpha()
    const image = bitmapOf(createDisplayImage(pixels))
    expect(sameBytes(image.pixels!, pixels.data)).toBe(true)
    expect(image.pixels!.buffer).not.toBe(pixels.data.buffer)
  })

  it('never changes the pixels, also when the image is released', () => {
    const pixels = everyAlpha()
    const before = pixels.data.slice()
    const image = createDisplayImage(pixels)
    expect(sameBytes(pixels.data, before)).toBe(true)
    releaseDisplayImage(image)
    expect(sameBytes(pixels.data, before)).toBe(true)
  })

  it('creates an independent image every time', () => {
    const pixels = everyAlpha()
    const first = createDisplayImage(pixels)
    const second = createDisplayImage(pixels)
    expect(second).not.toBe(first)
    releaseDisplayImage(first)
    expect(isReleasedDisplayImage(first)).toBe(true)
    expect(isReleasedDisplayImage(second)).toBe(false)
    expect(sameBytes(bitmapOf(second).pixels!, pixels.data)).toBe(true)
  })

  it('keeps the canvas in main memory and releases it once the bitmap has been transferred', () => {
    createDisplayImage(everyAlpha())
    expect(browser.contextOptions).toEqual([{ willReadFrequently: true }])
    expect(browser.canvases).toHaveLength(1)
    expect(browser.canvases[0].kind).toBe('offscreen')
    expect(browser.canvases[0].released()).toBe(true)
  })
})

describe('createDisplayImage fallback to a canvas element', () => {
  function expectCanvasElement(image: DisplayImage, pixels: PixelBuffer) {
    const canvas = canvasOf(image)
    expect(canvas).toBeInstanceOf(FakeCanvas)
    expect(canvas.kind).toBe('element')
    expect([canvas.width, canvas.height]).toEqual([pixels.width, pixels.height])
    expect(sameBytes(canvas.pixels, pixels.data)).toBe(true)
    expect(browser.puts.at(-1)!.imageData.data).toBe(pixels.data)
    expect(browser.contextOptions.at(-1)).toEqual({ willReadFrequently: true })
  }

  it('uses a canvas element where OffscreenCanvas is missing', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const pixels = everyAlpha()
    expectCanvasElement(createDisplayImage(pixels), pixels)
    expect(browser.canvases).toHaveLength(1)
  })

  it('uses a canvas element where OffscreenCanvas cannot transfer its bitmap', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvasWithoutTransfer)
    const pixels = everyAlpha()
    expectCanvasElement(createDisplayImage(pixels), pixels)
    // Detected without creating an OffscreenCanvas.
    expect(browser.canvases.map((canvas) => canvas.kind)).toEqual(['element'])
  })

  it('uses a canvas element where OffscreenCanvas has no 2D context, releasing the OffscreenCanvas', () => {
    browser.noContext.offscreen = true
    const pixels = everyAlpha()
    expectCanvasElement(createDisplayImage(pixels), pixels)
    const [offscreen] = browser.canvases
    expect(offscreen.kind).toBe('offscreen')
    expect(offscreen.released()).toBe(true)
  })

  it('never changes the pixels, and the element can be released', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const pixels = everyAlpha()
    const before = pixels.data.slice()
    const image = createDisplayImage(pixels)
    expect(sameBytes(pixels.data, before)).toBe(true)
    releaseDisplayImage(image)
    expect(isReleasedDisplayImage(image)).toBe(true)
    expect(sameBytes(pixels.data, before)).toBe(true)
  })
})

describe('createDisplayImage failures', () => {
  it('rejects pixels that are not a complete RGBA image before creating anything', () => {
    const invalid: PixelBuffer[] = [
      { width: 0, height: 1, data: new Uint8ClampedArray(0) },
      { width: 2, height: 0, data: new Uint8ClampedArray(0) },
      { width: 1.5, height: 2, data: new Uint8ClampedArray(12) },
      { width: Number.NaN, height: 1, data: new Uint8ClampedArray(4) },
      { width: -1, height: -1, data: new Uint8ClampedArray(4) },
      { width: 2, height: 2, data: new Uint8ClampedArray(15) },
      { width: 2, height: 2, data: new Uint8ClampedArray(new ArrayBuffer(24), 2, 16) },
    ]
    const detached = new Uint8ClampedArray(16)
    structuredClone(detached.buffer, { transfer: [detached.buffer] })
    invalid.push({ width: 2, height: 2, data: detached })
    for (const pixels of invalid) expect(() => createDisplayImage(pixels)).toThrow(RangeError)
    expect(browser.canvases).toHaveLength(0)
  })

  it('throws when no 2D canvas of either kind is available, leaving nothing allocated', () => {
    browser.noContext = { offscreen: true, element: true }
    expect(() => createDisplayImage(everyAlpha())).toThrow('No 2D canvas')
    expect(browser.canvases.map((canvas) => canvas.kind)).toEqual(['offscreen', 'element'])
    expect(browser.canvases.every((canvas) => canvas.released())).toBe(true)
  })

  it('throws without a document or OffscreenCanvas (no browser)', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', undefined)
    expect(() => createDisplayImage(everyAlpha())).toThrow('No 2D canvas')
  })

  it('releases the canvas and reports the error when writing the pixels fails, without trying another canvas', () => {
    browser.failPut.offscreen = true
    expect(() => createDisplayImage(everyAlpha())).toThrow('putImageData failed')
    expect(browser.canvases).toHaveLength(1)
    expect(browser.canvases[0].released()).toBe(true)
  })

  it('releases the canvas and reports the error when the bitmap cannot be created', () => {
    browser.failTransfer = true
    expect(() => createDisplayImage(everyAlpha())).toThrow('ImageBitmap construction failed')
    expect(browser.canvases[0].released()).toBe(true)
    expect(browser.bitmaps).toHaveLength(0)
  })

  it('closes a bitmap of the wrong size and releases the canvas', () => {
    browser.shrinkBitmap = 1
    expect(() => createDisplayImage(everyAlpha())).toThrow('Created a 63 × 8 bitmap for 64 × 8 pixels')
    expect(browser.bitmaps).toHaveLength(1)
    expect(browser.bitmaps[0].closeCalls).toBe(1)
    expect(browser.canvases[0].released()).toBe(true)
  })

  it('releases the canvas element when writing the pixels fails', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    browser.failPut.element = true
    expect(() => createDisplayImage(everyAlpha())).toThrow('putImageData failed')
    expect(browser.canvases).toHaveLength(1)
    expect(browser.canvases[0].released()).toBe(true)
  })

  it('leaves the pixels unchanged when it fails', () => {
    const pixels = everyAlpha()
    const before = pixels.data.slice()
    browser.failTransfer = true
    expect(() => createDisplayImage(pixels)).toThrow()
    expect(sameBytes(pixels.data, before)).toBe(true)
  })
})

describe('releaseDisplayImage', () => {
  it('closes a bitmap; releasing it again does nothing more', () => {
    const image = createDisplayImage(everyAlpha())
    expect(isReleasedDisplayImage(image)).toBe(false)
    releaseDisplayImage(image)
    releaseDisplayImage(image)
    expect(isReleasedDisplayImage(image)).toBe(true)
    expect(bitmapOf(image).pixels).toBeNull()
  })

  it('empties a canvas element', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const image = createDisplayImage(everyAlpha())
    expect(isReleasedDisplayImage(image)).toBe(false)
    releaseDisplayImage(image)
    releaseDisplayImage(image)
    expect(isReleasedDisplayImage(image)).toBe(true)
    expect(canvasOf(image).pixels).toHaveLength(0)
  })
})

describe('displayContentKey', () => {
  it('differs between documents and between revisions, and is stable for one revision', () => {
    expect(displayContentKey({ id: 3, revision: 7 })).toBe(displayContentKey({ id: 3, revision: 7 }))
    const keys = [
      [1, 0], [1, 1], [2, 0], [1, 23], [12, 3], [123, 0], [1, 230],
    ].map(([id, revision]) => displayContentKey({ id, revision }))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('createDisplayImageOwner', () => {
  const image = () => createDisplayImage({ width: 2, height: 2, data: new Uint8ClampedArray(16) })

  it('releases an image only once another has been shown', () => {
    const owner = createDisplayImageOwner()
    const [a, b] = [image(), image()]
    owner.show(a)
    // Another render, or React Strict Mode running the effect again.
    owner.show(a)
    expect(isReleasedDisplayImage(a)).toBe(false)
    owner.show(b)
    expect(isReleasedDisplayImage(a)).toBe(true)
    expect(isReleasedDisplayImage(b)).toBe(false)
    owner.show(b)
    expect(isReleasedDisplayImage(b)).toBe(false)
    expect(bitmapOf(a).closeCalls).toBe(1)
  })

  it('releases the shown image when nothing is shown any more, and nothing else', () => {
    const owner = createDisplayImageOwner()
    const [a, b] = [image(), image()]
    owner.show(null)
    owner.show(a)
    owner.show(null)
    expect(isReleasedDisplayImage(a)).toBe(true)
    owner.show(null)
    owner.show(b)
    expect(isReleasedDisplayImage(b)).toBe(false)
    expect(bitmapOf(a).closeCalls).toBe(1)
  })

  it('releases only images it has shown: one replaced before any frame showed it is left to its creator', () => {
    // Two replacements in one React commit: the canvas only ever sees the last one.
    const owner = createDisplayImageOwner()
    const [a, skipped, c] = [image(), image(), image()]
    owner.show(a)
    owner.show(c)
    expect(isReleasedDisplayImage(a)).toBe(true)
    expect(isReleasedDisplayImage(skipped)).toBe(false)
    expect(isReleasedDisplayImage(c)).toBe(false)
  })

  it('hands over to a remounted canvas: the shown image stays live, and the new owner releases it once replaced', () => {
    const unmounted = createDisplayImageOwner()
    const [a, b] = [image(), image()]
    unmounted.show(a)
    // The component unmounts (nothing is released in clean-ups) and mounts again with a new owner.
    const remounted = createDisplayImageOwner()
    remounted.show(a)
    expect(isReleasedDisplayImage(a)).toBe(false)
    remounted.show(b)
    expect(isReleasedDisplayImage(a)).toBe(true)
    expect(isReleasedDisplayImage(b)).toBe(false)
    expect(bitmapOf(a).closeCalls).toBe(1)
  })
})
