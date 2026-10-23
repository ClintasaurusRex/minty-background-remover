import { createImageDocument } from '../../editor/imageDocument'
import type { ImageDocument, ImageFormat, ImageSource } from '../../editor/types'
import type { DecodedSource, ImportDecoder, RasterFormat } from './decoder'
import { type ImportError, createImportError, toImportError } from './errors'
import { inspectImageFile } from './formats'
import { type DeclaredDimensions, readDeclaredDimensions } from './headerDimensions'
import { DEFAULT_IMPORT_LIMITS, type ImportLimits, validateDimensions } from './limits'
import { findPngEndingProblem } from './pngEnding'
import { type SvgElementLike, analyseSvg, checkSvgMarkup } from './svgSafety'
import { resolveSvgSize } from './svgSize'

export interface ImportRequest {
  readonly blob: Blob
  readonly name: string
  readonly source: ImageSource
}

export interface ImportDependencies<TElement extends SvgElementLike> {
  readonly decoder: ImportDecoder<TElement>
  readonly limits?: ImportLimits
  /**
   * Aborted when the import is no longer wanted. Checked between stages, so a
   * superseded import skips decoding and never allocates its full pixel buffer.
   */
  readonly signal?: AbortSignal
}

export type ImportResult =
  | { readonly ok: true; readonly document: ImageDocument }
  | { readonly ok: false; readonly error: ImportError }

/**
 * Imports an image file or clipboard blob:
 *
 * 1. Check the file size and identify the format from its content.
 * 2. Raster: check the dimensions declared in the header (and that a PNG is not
 *    truncated), then decode.
 *    SVG: parse, apply the safety policy, resolve and check its size, then rasterise.
 * 3. Check the decoded size before allocating the full RGBA buffer.
 * 4. Build the ImageDocument.
 *
 * Never throws: every failure is returned as a typed ImportError. Decoder resources
 * are always released. Nothing outside the returned value is changed, so a failed
 * import cannot affect the currently open image.
 */
export async function importImage<TElement extends SvgElementLike>(
  request: ImportRequest,
  dependencies: ImportDependencies<TElement>,
): Promise<ImportResult> {
  const limits = dependencies.limits ?? DEFAULT_IMPORT_LIMITS
  try {
    const { signal } = dependencies
    const check = await inspectImageFile(request.blob, limits)
    if (!check.ok) return check
    if (signal?.aborted) return cancelled()

    const decoded =
      check.format === 'svg'
        ? await decodeSvg(request.blob, dependencies.decoder, limits)
        : await decodeRaster(request.blob, check.format, dependencies.decoder, limits)
    if (!decoded.ok) return decoded
    if (signal?.aborted) {
      decoded.source.release()
      return cancelled()
    }

    return buildDocument(request, check.format, decoded.source, limits)
  } catch (cause) {
    return failure(toImportError(cause, 'decode-failed'))
  }
}

/** A superseded import. Never shown: the runner discards results of superseded imports. */
function cancelled(): ImportResult {
  return failure(createImportError('decode-failed', 'Cancelled because a newer import started'))
}

type DecodeResult =
  | { readonly ok: true; readonly source: DecodedSource }
  | { readonly ok: false; readonly error: ImportError }

async function decodeRaster(
  blob: Blob,
  format: RasterFormat,
  decoder: Pick<ImportDecoder, 'decodeRaster'>,
  limits: ImportLimits,
): Promise<DecodeResult> {
  let declared: DeclaredDimensions
  try {
    declared = await readDeclaredDimensions(blob, format)
  } catch (cause) {
    return failure(toImportError(cause, 'read-failed'))
  }
  if (declared.kind === 'malformed') return failure(createImportError('decode-failed', declared.detail))
  if (declared.kind === 'known') {
    const error = validateDimensions(declared.size, limits)
    if (error) return failure(error)
  }

  if (format === 'png') {
    let problem: string | null
    try {
      problem = await findPngEndingProblem(blob)
    } catch (cause) {
      return failure(toImportError(cause, 'read-failed'))
    }
    if (problem) return failure(createImportError('decode-failed', problem))
  }

  try {
    return { ok: true, source: await decoder.decodeRaster(blob, format) }
  } catch (cause) {
    return failure(toImportError(cause, 'decode-failed'))
  }
}

async function decodeSvg<TElement extends SvgElementLike>(
  blob: Blob,
  decoder: ImportDecoder<TElement>,
  limits: ImportLimits,
): Promise<DecodeResult> {
  let markup: string
  try {
    markup = await blob.text()
  } catch (cause) {
    return failure(toImportError(cause, 'read-failed'))
  }

  const markupError = checkSvgMarkup(markup)
  if (markupError) return failure(markupError)

  const parsed = decoder.parseSvg(markup)
  if (!parsed) return failure(createImportError('decode-failed', 'SVG is not well-formed XML'))

  const analysis = analyseSvg(parsed)
  if (!analysis.ok) return analysis

  const size = resolveSvgSize(analysis.sizeAttributes)
  if (!size) {
    const { width, height, viewBox } = analysis.sizeAttributes
    return failure(
      createImportError('svg-size-unknown', `width=${width}, height=${height}, viewBox=${viewBox}`),
    )
  }
  const error = validateDimensions(size, limits)
  if (error) return failure(error)

  try {
    return { ok: true, source: await decoder.rasteriseSvg(parsed, size) }
  } catch (cause) {
    return failure(toImportError(cause, 'decode-failed'))
  }
}

function buildDocument(
  request: ImportRequest,
  format: ImageFormat,
  source: DecodedSource,
  limits: ImportLimits,
): ImportResult {
  try {
    // Checked again after decoding: the header may have been unreadable, and EXIF
    // orientation or SVG rendering determine the final size.
    const error = validateDimensions({ width: source.width, height: source.height }, limits)
    if (error) return failure(error)

    const pixels = source.toImageData()
    if (pixels.width !== source.width || pixels.height !== source.height) {
      return failure(
        createImportError(
          'decode-failed',
          `Decoded ${pixels.width} × ${pixels.height}, expected ${source.width} × ${source.height}`,
        ),
      )
    }

    const document = createImageDocument({
      name: request.name,
      format,
      source: request.source,
      fileSizeBytes: request.blob.size,
      pixels,
    })
    return { ok: true, document }
  } catch (cause) {
    return failure(toImportError(cause, 'decode-failed'))
  } finally {
    source.release()
  }
}

function failure(error: ImportError): { readonly ok: false; readonly error: ImportError } {
  return { ok: false, error }
}
