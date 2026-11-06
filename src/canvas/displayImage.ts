import type { PixelBuffer } from '../editor/types'
import { validatePixelBuffer } from '../image/pixelBuffer'
import { toImageData } from './imageData'

/*
 * Display images: drawable copies of a document's pixels, which the workspace renderer draws.
 *
 * Creation is synchronous, so an edit can hand the editor its new document and the image that
 * shows it in a single update, and the canvas never shows the pixels of another revision.
 *
 * Strategies, in order (each writes the pixels once, with putImageData):
 *
 * 1. OffscreenCanvas → transferToImageBitmap: an immutable ImageBitmap. Chrome hands the
 *    canvas's memory to the bitmap without copying; Firefox 158 copies it (about 11 ms at 4K
 *    and 68 ms at 50 MP, and twice the image's memory until the copy is done).
 * 2. A canvas element that is itself the display image, where OffscreenCanvas, its 2D context
 *    or transferToImageBitmap is missing. It is never added to the page.
 *
 * Both contexts are created with willReadFrequently, which keeps the canvas in main memory
 * rather than on the GPU. Measured in Chrome 156: a GPU-backed bitmap or canvas comes back
 * blank, silently, after the GPU process restarts, so the workspace could not redraw the image
 * when its own context is restored. A bitmap from a main-memory canvas survives, as the import
 * path's bitmaps (createImageBitmap) do, and shows the same bytes as they do. (The fallback canvas
 * element survived only with GPU acceleration on; Chrome never needs the fallback.)
 *
 * Canvases store colour premultiplied by alpha, so a display image shows what drawing the pixels
 * shows: opaque pixels exactly, fully transparent pixels as transparent black (hidden colour is
 * never displayable), partially transparent pixels with the canvas's usual rounding (less than
 * one level of premultiplied colour). The pixel buffer is wrapped, not copied (toImageData), and
 * never written.
 *
 * Ownership (editor commands of Phase 3 Steps 5 and 6):
 *
 * - createDisplayImage returns a new image that only the caller holds. If creation fails,
 *   nothing stays allocated, and the caller keeps the current document and display image.
 * - A command creates it in its event handler, never in a reducer or state updater (React Strict
 *   Mode runs those twice), and hands it to the editor in the same action as the document whose
 *   pixels it shows. Before dispatching it checks that the result is still current (the document
 *   version it was computed from is still the open one, as the reducer will); if it is not, or
 *   anything fails after creation, the command releases the image itself (releaseDisplayImage).
 * - The editor state holds the current image; the workspace canvas releases it (one
 *   createDisplayImageOwner per ImageCanvas) after the commit that replaces it, once the
 *   replacement has been drawn. Nothing is released on unmount or in effect clean-ups, which
 *   React Strict Mode runs while the image is still shown; a remounted canvas takes over.
 * - The canvas releases only images it has shown. An image the reducer rejects is released by the
 *   code that dispatched it, and only once the action is committed: only the committed state tells
 *   whether it is in use (React can process a queued action against another state than the
 *   command saw), so releasing it earlier could blank the canvas. Edit, Undo and Redo actions are
 *   dispatched by app/editDispatch.ts, which commits each with flushSync and then releases a
 *   rejected action's image; the reducer never accepts a released image (it has no size).
 * - Display images are never kept in history or reused for another revision, and no state may
 *   bring back an image that an earlier state replaced: it may have been released. Undo and Redo
 *   create a new one for the restored pixels, as they create a new revision.
 */

/** A drawable copy of a document's pixels. Released with releaseDisplayImage, after which it must not be drawn. */
export type DisplayImage = ImageBitmap | HTMLCanvasElement

/**
 * Keeps both canvases in main memory: GPU-backed canvases and bitmaps lose their pixels when
 * the browser's GPU process restarts.
 */
const CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = { willReadFrequently: true }

/**
 * A new display image of `pixels`, the same size, created synchronously. `pixels` is not
 * changed or copied (only the canvas holds a copy).
 *
 * Throws a RangeError if `pixels` is not a complete RGBA image (validatePixelBuffer), before
 * anything is allocated, and an Error if the browser cannot create the image (no 2D canvas, or
 * the canvas or bitmap could not be created, for example for lack of memory). Nothing stays
 * allocated when it throws.
 */
export function createDisplayImage(pixels: PixelBuffer): DisplayImage {
  validatePixelBuffer(pixels)
  const imageData = toImageData(pixels)
  const image = transferredBitmap(imageData) ?? canvasElement(imageData)
  if (!image) throw new Error('No 2D canvas is available to display the image')
  return image
}

/** Releases the image's memory now rather than at garbage collection. Releasing it again does nothing. */
export function releaseDisplayImage(image: DisplayImage): void {
  if ('close' in image) {
    image.close()
  } else {
    image.width = 0
    image.height = 0
  }
}

/**
 * Whether `image` has been released (a closed bitmap, or a canvas with no pixels), so drawing it
 * would throw. Display images are never empty otherwise: documents are at least 1 × 1.
 */
export function isReleasedDisplayImage(image: DisplayImage): boolean {
  return image.width === 0 || image.height === 0
}

/**
 * Identifies the pixel content a display image shows: the document's id and revision. Every
 * content state has its own revision, never reused, so a different key always means different
 * content, even when the image object is the same.
 */
export function displayContentKey(document: { readonly id: number; readonly revision: number }): string {
  return `${document.id}:${document.revision}`
}

/** The display image the workspace shows, released once the workspace shows another. */
export interface DisplayImageOwner {
  /**
   * Call after `image` has been drawn (or the canvas cleared, for null). Releases the image shown
   * before unless it is the same one, so showing the same image again (another render, or React
   * Strict Mode running effects twice) releases nothing.
   */
  show(image: DisplayImage | null): void
}

export function createDisplayImageOwner(): DisplayImageOwner {
  let shown: DisplayImage | null = null
  return {
    show(image) {
      if (shown && shown !== image) releaseDisplayImage(shown)
      shown = image
    },
  }
}

/**
 * Strategy 1, or null where OffscreenCanvas, its 2D context or transferToImageBitmap is missing.
 */
function transferredBitmap(imageData: ImageData): ImageBitmap | null {
  if (typeof OffscreenCanvas === 'undefined' || typeof OffscreenCanvas.prototype.transferToImageBitmap !== 'function') {
    return null
  }
  const { width, height } = imageData
  const canvas = new OffscreenCanvas(width, height)
  try {
    const context = canvas.getContext('2d', CONTEXT_OPTIONS)
    if (!context) return null
    context.putImageData(imageData, 0, 0)
    const bitmap = canvas.transferToImageBitmap()
    if (bitmap.width !== width || bitmap.height !== height) {
      const message = `Created a ${bitmap.width} × ${bitmap.height} bitmap for ${width} × ${height} pixels`
      bitmap.close()
      throw new Error(message)
    }
    return bitmap
  } finally {
    // The bitmap keeps the pixels. The transfer left the canvas a new, empty bitmap of the same
    // size (or the pixels, if something failed): release it now.
    canvas.width = 0
    canvas.height = 0
  }
}

/** Strategy 2, or null where there is no document or no 2D context. */
function canvasElement(imageData: ImageData): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const { width, height } = imageData
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  let complete = false
  try {
    const context = canvas.getContext('2d', CONTEXT_OPTIONS)
    if (!context) return null
    context.putImageData(imageData, 0, 0)
    if (canvas.width !== width || canvas.height !== height) {
      throw new Error(`Created a ${canvas.width} × ${canvas.height} canvas for ${width} × ${height} pixels`)
    }
    complete = true
    return canvas
  } finally {
    if (!complete) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
