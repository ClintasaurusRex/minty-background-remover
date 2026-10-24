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

/** The open image. Its pixels are the source of truth; viewing never changes them. */
export interface ImageDocument {
  /** Unique per import; keys caches derived from the pixels. */
  readonly id: number
  /** Display name, e.g. the original file name. */
  readonly name: string
  readonly format: ImageFormat
  readonly source: ImageSource
  readonly fileSizeBytes: number
  /** Always equal to pixels.width / pixels.height. */
  readonly width: number
  readonly height: number
  /** Non-premultiplied 8-bit RGBA, row-major, at full original resolution. */
  readonly pixels: ImageData
  /** Increases whenever pixels change. Always 0 in Phase 1. */
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
 * Everything is in CSS pixels. Device pixel ratio is applied only when drawing
 * (see canvas/devicePixels.ts), so pointer hit-testing never depends on it.
 */
export interface ViewportState {
  /** CSS pixels per image pixel. 1 = 100%. */
  readonly zoom: number
  /** Position of the top-left corner of image pixel (0, 0), relative to the viewport's top-left. */
  readonly offset: Point
}
