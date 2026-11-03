// In the browser: display-image correctness and creation timing, with the project's own modules.
import { createDisplayImage, displayContentKey, isReleasedDisplayImage, releaseDisplayImage } from '/src/canvas/displayImage.ts'
import { planFrame } from '/src/canvas/rendering.ts'
import { createWorkspaceRenderer } from '/src/canvas/workspaceRenderer.ts'

const workspace = document.getElementById('workspace')
const VIEW = { width: 1600, height: 900 }
const renderer = createWorkspaceRenderer(workspace)
const workspaceContext = workspace.getContext('2d')

// Image draws onto the workspace canvas.
let draws = 0
const drawImage = CanvasRenderingContext2D.prototype.drawImage
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === workspace) draws++
  return drawImage.apply(this, args)
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
// Reading one pixel waits for the drawing to finish.
const finishDrawing = () => workspaceContext.getImageData(0, 0, 1, 1)
const fitPlan = (width, height) => {
  const zoom = Math.min(1, (VIEW.width - 48) / width, (VIEW.height - 48) / height)
  const offset = { x: Math.round((VIEW.width - width * zoom) / 2), y: Math.round((VIEW.height - height * zoom) / 2) }
  return planFrame({ imageSize: { width, height }, viewport: { zoom, offset }, viewportSize: VIEW, devicePixelRatio })
}

/** Runs `create` with the fallback forced: as if OffscreenCanvas were missing. */
function withoutOffscreenCanvas(create) {
  const saved = globalThis.OffscreenCanvas
  globalThis.OffscreenCanvas = undefined
  try {
    return create()
  } finally {
    globalThis.OffscreenCanvas = saved
  }
}

/** Photo-like noise (opaque), or a deleted background: transparent outside an ellipse with a soft edge, colour kept. */
function makePixels(width, height, content) {
  const data = new Uint8ClampedArray(width * height * 4)
  const words = new Uint32Array(data.buffer)
  let seed = 7
  for (let y = 0; y < height; y++) {
    const dy = (y - height / 2) / (height * 0.35)
    for (let x = 0; x < width; x++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      let a = 255
      if (content === 'deleted') {
        const r = ((x - width / 2) / (width * 0.35)) ** 2 + dy * dy
        a = r < 0.98 ? 255 : r < 1.02 ? Math.round(((1.02 - r) / 0.04) * 255) : 0
      }
      words[y * width + x] = ((a << 24) | ((seed >>> 8) & 0xffffff)) >>> 0
    }
  }
  return { width, height, data }
}

/** What drawing `source` 1:1 onto a new canvas shows. */
function readBack(source, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0)
  const data = context.getImageData(0, 0, width, height).data
  canvas.width = canvas.height = 0
  return data
}

async function correctness() {
  const out = {}
  // Every alpha value with distinct colour on 4 rows, colour kept under alpha 0.
  const width = 256
  const height = 4
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let a = 0; a < 256; a++) {
      const i = (y * width + a) * 4
      data[i] = (a * 37 + y * 91 + 11) & 255
      data[i + 1] = (a * 101 + y * 13 + 200) & 255
      data[i + 2] = (a * 7 + y * 151 + 99) & 255
      data[i + 3] = a
    }
  }
  const pixels = { width, height, data }
  const before = data.slice()
  // The import path's bitmap, for comparison.
  const reference = readBack(await createImageBitmap(new ImageData(data, width, height)), width, height)
  const evaluate = (image) => {
    const shown = readBack(image, width, height)
    const result = { kind: image.constructor.name, size: [image.width, image.height], differentFromImportPath: 0, opaqueWrong: 0, transparentWrong: 0, alphaWrong: 0, maxPremultipliedError: 0 }
    for (let i = 0; i < shown.length; i++) if (shown[i] !== reference[i]) result.differentFromImportPath++
    for (let i = 0; i < shown.length; i += 4) {
      const a = data[i + 3]
      if (shown[i + 3] !== a) result.alphaWrong++
      if (a === 255 && (shown[i] !== data[i] || shown[i + 1] !== data[i + 1] || shown[i + 2] !== data[i + 2])) result.opaqueWrong++
      if (a === 0 && (shown[i] || shown[i + 1] || shown[i + 2] || shown[i + 3])) result.transparentWrong++
      if (a > 0 && a < 255) for (let k = 0; k < 3; k++) result.maxPremultipliedError = Math.max(result.maxPremultipliedError, (Math.abs(shown[i + k] - data[i + k]) * a) / 255)
    }
    result.maxPremultipliedError = +result.maxPremultipliedError.toFixed(3)
    releaseDisplayImage(image)
    return result
  }

  out.transfer = evaluate(createDisplayImage(pixels))
  out.fallbackWithoutOffscreenCanvas = evaluate(withoutOffscreenCanvas(() => createDisplayImage(pixels)))
  const transfer = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'transferToImageBitmap')
  delete OffscreenCanvas.prototype.transferToImageBitmap
  try {
    out.fallbackWithoutTransfer = evaluate(createDisplayImage(pixels))
  } finally {
    Object.defineProperty(OffscreenCanvas.prototype, 'transferToImageBitmap', transfer)
  }
  out.sourceUnchanged = data.every((value, i) => value === before[i])

  // A released image is never drawn, and drawing it does not throw.
  const released = createDisplayImage(pixels)
  releaseDisplayImage(released)
  releaseDisplayImage(released)
  out.released = { isReleased: isReleasedDisplayImage(released), size: [released.width, released.height] }
  try {
    renderer.render(fitPlan(width, height), { image: released, key: 'released' })
    out.renderReleased = 'no error'
  } catch (error) {
    out.renderReleased = String(error)
  }

  // What the renderer draws for each kind of change.
  const a = createDisplayImage(pixels)
  const b = createDisplayImage(pixels)
  const counts = {}
  const step = (label, action) => {
    const n = draws
    action()
    counts[label] = draws - n
  }
  step('first frame', () => renderer.render(fitPlan(width, height), { image: a, key: displayContentKey({ id: 1, revision: 0 }) }))
  step('identical frame', () => renderer.render(fitPlan(width, height), { image: a, key: displayContentKey({ id: 1, revision: 0 }) }))
  step('new revision, same image', () => renderer.render(fitPlan(width, height), { image: a, key: displayContentKey({ id: 1, revision: 1 }) }))
  step('new image, same key', () => renderer.render(fitPlan(width, height), { image: b, key: displayContentKey({ id: 1, revision: 1 }) }))
  step('invalidate alone', () => renderer.invalidate())
  step('identical frame after invalidate', () => renderer.render(fitPlan(width, height), { image: b, key: displayContentKey({ id: 1, revision: 1 }) }))
  step('contextrestored event', () => workspace.dispatchEvent(new Event('contextrestored')))
  out.rendererDraws = counts
  renderer.render(fitPlan(1, 1), null)
  releaseDisplayImage(a)
  releaseDisplayImage(b)

  // The largest images the app accepts: 16,384 px on a side, 50 megapixels.
  out.largest = {}
  for (const [w, h] of [[16384, 3051], [8660, 5773]]) {
    const image = createDisplayImage({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
    out.largest[`${w}×${h}`] = { kind: image.constructor.name, size: [image.width, image.height] }
    releaseDisplayImage(image)
  }
  return out
}

/** Creation time and time to the first frame drawn, median of `reps` runs after one warm-up. */
async function timing(sizes, contents, reps) {
  const rows = []
  for (const [width, height] of sizes) {
    for (const content of contents) {
      const pixels = makePixels(width, height, content)
      for (const strategy of ['transfer', 'element', 'createImageBitmap']) {
        const create = []
        const firstFrame = []
        for (let run = 0; run <= reps; run++) {
          await nextFrame()
          const start = performance.now()
          const image =
            strategy === 'createImageBitmap'
              ? await createImageBitmap(new ImageData(pixels.data, width, height))
              : strategy === 'element'
                ? withoutOffscreenCanvas(() => createDisplayImage(pixels))
                : createDisplayImage(pixels)
          const created = performance.now()
          renderer.render(fitPlan(width, height), { image, key: `${width}x${height}:${run}:${strategy}` })
          finishDrawing()
          const drawn = performance.now()
          renderer.render(fitPlan(1, 1), null)
          releaseDisplayImage(image)
          if (run === 0) continue
          create.push(created - start)
          firstFrame.push(drawn - start)
        }
        rows.push({
          size: `${width}×${height}`,
          content,
          strategy: { transfer: 'transferToImageBitmap', element: 'canvas element (fallback)', createImageBitmap: 'createImageBitmap (import path, async)' }[strategy],
          createMs: +median(create).toFixed(1),
          createMaxMs: +Math.max(...create).toFixed(1),
          firstFrameMs: +median(firstFrame).toFixed(1),
        })
      }
    }
  }
  return rows
}

window.__bench = { correctness, timing }
window.__ready = true
