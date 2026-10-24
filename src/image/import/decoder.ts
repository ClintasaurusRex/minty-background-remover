import type { ImageFormat, Size } from '../../editor/types'
import type { ParsedSvg, SvgElementLike } from './svgSafety'

export type RasterFormat = Exclude<ImageFormat, 'svg'>

/**
 * A decoded image whose size is known but whose full RGBA buffer has not been
 * allocated yet, so the size can be validated first.
 */
export interface DecodedSource {
  readonly width: number
  readonly height: number
  /** Allocates and returns the full-resolution RGBA pixels. Call at most once. */
  toImageData(): ImageData
  /** Frees decoder resources. Safe to call more than once, and after toImageData(). */
  release(): void
}

/**
 * Platform-specific decoding, injected into importImage so the orchestration can be
 * tested without a browser. The browser implementation is in browserDecoder.ts.
 *
 * Methods may throw ImportFailure for a specific error; anything else thrown is
 * reported as 'decode-failed'.
 */
export interface ImportDecoder<TElement extends SvgElementLike = SvgElementLike> {
  /** Decodes a PNG, JPEG or WebP whose format has already been identified from its content. */
  decodeRaster(blob: Blob, format: RasterFormat): Promise<DecodedSource>
  /** Parses SVG markup without rendering it or loading anything. Null if not well-formed XML. */
  parseSvg(markup: string): ParsedSvg<TElement> | null
  /** Rasterises a parsed SVG that has passed analyseSvg, at exactly `size`. */
  rasteriseSvg(svg: ParsedSvg<TElement>, size: Size): Promise<DecodedSource>
}
