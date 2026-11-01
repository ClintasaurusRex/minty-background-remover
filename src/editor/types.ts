/** Identifiers for the editing tools planned for the main toolbar. */
export type ToolId = 'magic-wand' | 'crop' | 'replace-color' | 'auto-trim'

export interface ToolDefinition {
  id: ToolId
  /** User-facing label (Canadian English). */
  label: string
  description: string
  /** False until the tool is implemented in its assigned phase. */
  available: boolean
}

/** Image file formats that can be imported. SVG is rasterised on import. */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg'

/** How an image entered the application. */
export type ImageSource = 'file-picker' | 'drop' | 'paste'

/**
 * Straight (non-premultiplied) 8-bit sRGB RGBA pixels, row-major, 4 bytes per pixel.
 * ImageData has this shape, so decoded pixels are used as they are; edits produce plain
 * buffers (image/pixelBuffer.ts), which need no canvas and can be tested in Node.
 *
 * Copy-on-write: a buffer is never written once it belongs to a document. An edit writes
 * new memory and becomes a new document revision, so the pixels of every earlier revision,
 * and anything computed from them, stay valid. `Readonly` blocks indexed writes; mutating
 * methods such as `set` and `fill`, and other views of `data.buffer`, must not be used on
 * a document's pixels either.
 */
export interface PixelBuffer {
  /** A whole number, at least 1. */
  readonly width: number
  /** A whole number, at least 1. */
  readonly height: number
  /**
   * Exactly width × height × 4 bytes, starting on a 4-byte boundary so that pixels can be
   * read as 32-bit values.
   */
  readonly data: Readonly<Uint8ClampedArray<ArrayBuffer>>
}

/**
 * The open image. Its pixels are the source of truth; viewing never changes them.
 *
 * Documents are immutable. A pixel edit makes a new document with the same id and a new
 * revision (createEditedDocument); the previous document is left as it was.
 */
export interface ImageDocument {
  /** Unique per opened image, never reused, and kept by edits. */
  readonly id: number
  /** Display name, e.g. the original file name. */
  readonly name: string
  readonly format: ImageFormat
  readonly source: ImageSource
  /** Size of the opened file. Describes the source; edits do not change it. */
  readonly fileSizeBytes: number
  /** Always equal to pixels.width / pixels.height. Auto Trim (Phase 3) changes them. */
  readonly width: number
  readonly height: number
  /** At full resolution; never resampled. */
  readonly pixels: PixelBuffer
  /**
   * Identifies the pixel content within the document: 0 when opened, and for every later
   * content state (an edit, Undo or Redo) a number never used before in the session and
   * larger than any earlier one. Undo and Redo restore earlier pixels as a new revision.
   * With `id` it forms the DocumentVersion that work computed from the pixels is tagged
   * with, so a result computed for any other content state is never accepted.
   */
  readonly revision: number
}

/** A position in some 2D coordinate space. The space is named by the function using it. */
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Axis-aligned rectangle; (x, y) is the top-left corner. */
export interface Rectangle extends Point, Size {}

/**
 * Integer index of one image pixel, always within the image:
 * 0 <= x < width and 0 <= y < height.
 *
 * Pixel (x, y) covers the half-open square [x, x + 1) × [y, y + 1) in image space.
 */
export interface PixelCoordinate {
  readonly x: number
  readonly y: number
}

/** Magic Wand flood mode: matching pixels connected to the clicked pixel, or every match in the image. */
export type FloodMode = 'contiguous' | 'global'

/** How a new selection combines with the current one. */
export type SelectionMode = 'new' | 'add' | 'subtract'

/**
 * The selected pixels of the open image. An empty selection is never a mask: it is `null`.
 *
 * Masks are never mutated. Every selection operation returns a new mask, so a mask can be
 * shared freely (renderer caches, a future undo history). `Readonly` blocks indexed writes;
 * mutating methods such as `fill` remain callable and must not be used.
 */
export interface SelectionMask {
  /** Always equal to the image's width and height. */
  readonly width: number
  readonly height: number
  /** Row-major, one byte per pixel: 1 = selected, 0 = not selected. Length is width × height. */
  readonly data: Readonly<Uint8Array>
  /** Number of selected pixels. Always at least 1. */
  readonly count: number
  /** Smallest rectangle containing every selected pixel, in image pixels. */
  readonly bounds: Readonly<Rectangle>
}

/**
 * How the image is presented in the workspace. Purely presentational: changing it never
 * touches image pixels or dimensions.
 *
 * Everything is in CSS pixels. Device pixel ratio is applied when drawing (see
 * canvas/devicePixels.ts) and, for pointer hit-testing, only to find the device pixel
 * the pointer is in (pixelUnderPointer in canvas/coordinates.ts).
 */
export interface ViewportState {
  /** CSS pixels per image pixel. 1 = 100%. */
  readonly zoom: number
  /** Position of the top-left corner of image pixel (0, 0), relative to the viewport's top-left. */
  readonly offset: Point
}
