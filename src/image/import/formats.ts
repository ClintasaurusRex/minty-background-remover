import type { ImageFormat } from '../../editor/types'
import { type ImportError, createImportError } from './errors'
import { DEFAULT_IMPORT_LIMITS, type ImportLimits, validateFileSize } from './limits'

/**
 * Bytes read from the start of a file to identify it. Raster signatures need 12; the
 * rest leaves room for the XML declaration, comments and DOCTYPE (editors such as
 * Illustrator write long ones) that may precede an SVG's root element.
 */
export const FORMAT_SNIFF_BYTES = 4096

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] // "WEBP" at offset 8

/**
 * Identifies an image from the first bytes of its content. File names and MIME types
 * are deliberately not considered: they are often wrong (renamed files, clipboard and
 * drag sources without types) and the content is what will actually be decoded.
 *
 * Returns null for unsupported formats (GIF, BMP, TIFF, …), empty input and input too
 * short to contain a complete signature.
 */
export function detectImageFormat(head: Uint8Array): ImageFormat | null {
  if (startsWith(head, PNG_SIGNATURE)) return 'png'
  if (startsWith(head, JPEG_SIGNATURE)) return 'jpeg'
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'webp'
  if (looksLikeSvg(head)) return 'svg'
  return null
}

/**
 * Identifies a Blob's format from its first bytes, or null if it is unsupported,
 * empty or unreadable. Used to choose among several candidates (dropped files,
 * clipboard items) before importing one; the import itself repeats the full checks.
 */
export async function sniffImageFormat(blob: Blob): Promise<ImageFormat | null> {
  try {
    return detectImageFormat(new Uint8Array(await blob.slice(0, FORMAT_SNIFF_BYTES).arrayBuffer()))
  } catch {
    return null
  }
}

export type ImageFileCheck =
  | { readonly ok: true; readonly format: ImageFormat }
  | { readonly ok: false; readonly error: ImportError }

/**
 * First import stage for a File or clipboard Blob: checks the file size, then reads
 * only the first FORMAT_SNIFF_BYTES to identify the format. Nothing is decoded.
 */
export async function inspectImageFile(
  blob: Blob,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): Promise<ImageFileCheck> {
  const sizeError = validateFileSize(blob.size, limits)
  if (sizeError) return { ok: false, error: sizeError }

  if (blob.size === 0) {
    return { ok: false, error: createImportError('decode-failed', 'The file is empty') }
  }

  let head: Uint8Array
  try {
    head = new Uint8Array(await blob.slice(0, FORMAT_SNIFF_BYTES).arrayBuffer())
  } catch (cause) {
    return { ok: false, error: createImportError('read-failed', String(cause)) }
  }

  const format = detectImageFormat(head)
  if (!format) {
    return {
      ok: false,
      error: createImportError('unsupported-format', `Unrecognised signature: ${hexPrefix(head)}`),
    }
  }
  return { ok: true, format }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

/**
 * True when the root element is <svg>, allowing a leading BOM, whitespace, an XML
 * declaration, processing instructions, comments and a DOCTYPE (with an internal
 * subset). UTF-16 SVG files are not recognised.
 */
function looksLikeSvg(head: Uint8Array): boolean {
  // Decoding strips a UTF-8 BOM; a character cut off at the end becomes U+FFFD.
  const text = new TextDecoder('utf-8').decode(head)
  let i = 0

  while (i < text.length) {
    i = skipWhitespace(text, i)
    if (text.startsWith('<?', i)) {
      i = indexAfter(text, '?>', i + 2)
    } else if (text.startsWith('<!--', i)) {
      i = indexAfter(text, '-->', i + 4)
    } else if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      i = indexAfterDoctype(text, i + 9)
    } else {
      return /^<svg[\s/>]/.test(text.slice(i, i + 5))
    }
    if (i < 0) return false
  }
  return false
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

/** Index just past `token`, or -1 if it does not occur. */
function indexAfter(text: string, token: string, from: number): number {
  const index = text.indexOf(token, from)
  return index < 0 ? -1 : index + token.length
}

/** Index just past a DOCTYPE's closing '>', skipping quoted strings and an internal subset. */
function indexAfterDoctype(text: string, from: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '[') {
      depth++
    } else if (char === ']') {
      depth--
    } else if (char === '>' && depth <= 0) {
      return i + 1
    }
  }
  return -1
}

function hexPrefix(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
