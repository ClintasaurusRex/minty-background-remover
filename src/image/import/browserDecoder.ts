import type { Size } from '../../editor/types'
import type { DecodedSource, ImportDecoder, RasterFormat } from './decoder'
import { ImportFailure, createImportError } from './errors'
import type { ParsedSvg } from './svgSafety'

/*
 * Browser implementation of ImportDecoder, using createImageBitmap, DOMParser, <img>
 * and a temporary canvas. Not covered by the Node test environment; see the manual
 * test notes in the Phase 1 Step 3 report.
 *
 * Canvas 2D limitations (accepted): 16-bit PNGs are reduced to 8 bits per channel,
 * colour profiles are converted to sRGB, and because canvases store premultiplied
 * alpha, very low-alpha pixels lose some RGB precision and fully transparent pixels
 * lose their RGB values.
 */

const RASTER_MIME_TYPES: Readonly<Record<RasterFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function createBrowserDecoder(): ImportDecoder<Element> {
  return { decodeRaster, parseSvg, rasteriseSvg }
}

async function decodeRaster(blob: Blob, format: RasterFormat): Promise<DecodedSource> {
  // Label the data with its detected type, since clipboard and drag sources may be
  // untyped or mislabelled. This wraps the existing data without copying it.
  const typed = new Blob([blob], { type: RASTER_MIME_TYPES[format] })
  // 'from-image' applies EXIF orientation, so width and height are as displayed.
  const bitmap = await createImageBitmap(typed, { imageOrientation: 'from-image' })

  let released = false
  const release = () => {
    if (!released) {
      released = true
      bitmap.close()
    }
  }

  return {
    width: bitmap.width,
    height: bitmap.height,
    toImageData() {
      return drawToImageData(bitmap.width, bitmap.height, (context) => {
        context.drawImage(bitmap, 0, 0)
        release() // free the decoded bitmap before the RGBA buffer is allocated
      })
    },
    release,
  }
}

/**
 * Parses markup as an inert XML document: DOMParser never runs scripts or loads
 * resources, and the document is never attached to the page.
 */
function parseSvg(markup: string): ParsedSvg<Element> | null {
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  if (document.getElementsByTagNameNS('*', 'parsererror').length > 0) return null

  const root = document.documentElement
  if (!root) return null

  const processingInstructions = Array.from(document.childNodes)
    .filter((node): node is ProcessingInstruction => node instanceof ProcessingInstruction)
    .map((node) => node.target)

  return { root, processingInstructions, hasDoctype: document.doctype !== null }
}

/**
 * Renders the SVG through an <img> element, which runs no scripts and fetches no
 * external resources, from a local object URL. The root is given explicit pixel
 * dimensions so every browser renders it at the resolved size.
 */
async function rasteriseSvg(svg: ParsedSvg<Element>, size: Size): Promise<DecodedSource> {
  svg.root.setAttribute('width', String(size.width))
  svg.root.setAttribute('height', String(size.height))
  const markup = new XMLSerializer().serializeToString(svg.root)

  const image = new Image()
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    image.src = url
    await image.decode()
  } catch (cause) {
    image.removeAttribute('src')
    throw cause
  } finally {
    URL.revokeObjectURL(url)
  }

  return {
    width: size.width,
    height: size.height,
    toImageData() {
      return drawToImageData(size.width, size.height, (context) => {
        context.drawImage(image, 0, 0, size.width, size.height)
      })
    },
    release() {
      image.removeAttribute('src')
    },
  }
}

type ScratchContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface ScratchCanvas {
  readonly context: ScratchContext | null
  /** Shrinking releases the backing store now rather than at garbage collection. */
  release(): void
}

function createScratchCanvas(width: number, height: number): ScratchCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    return {
      context: canvas.getContext('2d', { willReadFrequently: true }),
      release: () => {
        canvas.width = 0
        canvas.height = 0
      },
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return {
    context: canvas.getContext('2d', { willReadFrequently: true }),
    release: () => {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

/** Draws into a temporary canvas, reads it back as ImageData and frees the canvas. */
function drawToImageData(width: number, height: number, draw: (context: ScratchContext) => void): ImageData {
  const canvas = createScratchCanvas(width, height)
  try {
    const { context } = canvas
    if (!context) {
      throw new ImportFailure(
        createImportError('decode-failed', `Could not create a ${width} × ${height} canvas`),
      )
    }
    draw(context)
    try {
      return context.getImageData(0, 0, width, height)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'SecurityError') {
        throw new ImportFailure(createImportError('svg-render-blocked', cause.message))
      }
      throw cause
    }
  } finally {
    canvas.release()
  }
}
