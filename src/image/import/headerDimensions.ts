import type { Size } from '../../editor/types'
import type { RasterFormat } from './decoder'

/*
 * Reads the dimensions a raster file declares in its header, before decoding, so
 * oversized images can be rejected without the browser allocating decoded memory.
 * Only the few bytes needed are read; nothing is decoded.
 */

export type DeclaredDimensions =
  /** Dimensions read from the header. */
  | { readonly kind: 'known'; readonly size: Size }
  /** The header could not be interpreted; the decoded size must be checked instead. */
  | { readonly kind: 'unknown'; readonly detail: string }
  /** The header is invalid in a way every decoder rejects; do not decode. */
  | { readonly kind: 'malformed'; readonly detail: string }

/** Upper bound on JPEG segments walked before the frame header (SOF). */
export const MAX_JPEG_SEGMENTS = 1024

export async function readDeclaredDimensions(
  blob: Blob,
  format: RasterFormat,
): Promise<DeclaredDimensions> {
  switch (format) {
    case 'png':
      return parsePngDimensions(await readBytes(blob, 0, PNG_HEADER_BYTES))
    case 'webp':
      return parseWebpDimensions(await readBytes(blob, 0, WEBP_HEADER_BYTES))
    case 'jpeg':
      return readJpegDimensions(blob)
  }
}

// PNG: signature (8), IHDR length (4), "IHDR" (4), width (4, BE), height (4, BE).
// IHDR must be the first chunk.
const PNG_HEADER_BYTES = 24

export function parsePngDimensions(bytes: Uint8Array): DeclaredDimensions {
  if (bytes.length < PNG_HEADER_BYTES) return malformed('PNG header is truncated')
  if (ascii(bytes, 12, 4) !== 'IHDR') return malformed('PNG does not start with an IHDR chunk')
  const view = dataView(bytes)
  return knownOrMalformed(view.getUint32(16), view.getUint32(20), 'PNG')
}

// WebP: "RIFF" (4), size (4), "WEBP" (4), first chunk FourCC (4), chunk size (4), payload.
const WEBP_HEADER_BYTES = 30

export function parseWebpDimensions(bytes: Uint8Array): DeclaredDimensions {
  if (bytes.length < 16) return malformed('WebP header is truncated')
  const view = dataView(bytes)
  const chunk = ascii(bytes, 12, 4)

  switch (chunk) {
    case 'VP8X': {
      // Extended format: canvas width − 1 and height − 1 as 24-bit little-endian values.
      if (bytes.length < 30) return malformed('WebP VP8X header is truncated')
      return knownOrMalformed(1 + uint24le(bytes, 24), 1 + uint24le(bytes, 27), 'WebP')
    }
    case 'VP8L': {
      // Lossless: signature 0x2f, then 14-bit width − 1 and height − 1, packed little-endian.
      if (bytes.length < 25) return malformed('WebP VP8L header is truncated')
      if (bytes[20] !== 0x2f) return malformed('WebP VP8L signature is invalid')
      const bits = view.getUint32(21, true)
      return knownOrMalformed((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'WebP')
    }
    case 'VP8 ': {
      // Lossy: 3-byte frame tag (bit 0 clear for a key frame), start code 9d 01 2a,
      // then 14-bit width and height (the top 2 bits are scaling flags).
      if (bytes.length < 30) return malformed('WebP VP8 header is truncated')
      if ((bytes[20] & 1) !== 0) return malformed('WebP VP8 data does not start with a key frame')
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
        return malformed('WebP VP8 start code is invalid')
      }
      return knownOrMalformed(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff, 'WebP')
    }
    default:
      return malformed(`WebP first chunk "${chunk}" is not VP8, VP8L or VP8X`)
  }
}

/**
 * Walks JPEG segment headers until the frame header (SOF), reading only the marker,
 * length and SOF fields of each segment. EXIF, XMP and ICC segments before the SOF can
 * be large, so this does not assume the SOF is near the start of the file.
 *
 * Browser JPEG decoders tolerate some structural damage, so problems here are
 * reported as 'unknown' rather than 'malformed' and the decoded size is checked instead.
 *
 * Dimensions are as stored, before EXIF orientation. Rotation swaps width and height,
 * which does not affect the limits.
 */
export async function readJpegDimensions(blob: Blob): Promise<DeclaredDimensions> {
  let position = 2 // after SOI (FF D8)

  for (let segment = 0; segment < MAX_JPEG_SEGMENTS; segment++) {
    // FF, marker, length (2), precision (1), height (2), width (2).
    const bytes = await readBytes(blob, position, position + 9)
    if (bytes.length < 2) return unknown('JPEG ended before the frame header')
    if (bytes[0] !== 0xff) return unknown(`Expected a JPEG marker at byte ${position}`)

    const marker = bytes[1]
    if (marker === 0xff) {
      position += 1 // fill byte
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2 // standalone marker without a length
      continue
    }
    if (marker === 0xd9 || marker === 0xda) {
      return unknown('JPEG image data started before the frame header')
    }
    if (bytes.length < 4) return unknown('JPEG segment header is truncated')

    const length = (bytes[2] << 8) | bytes[3]
    if (length < 2) return unknown(`JPEG segment at byte ${position} has an invalid length`)

    if (isStartOfFrame(marker)) {
      if (bytes.length < 9 || length < 7) return unknown('JPEG frame header is truncated')
      const height = (bytes[5] << 8) | bytes[6]
      const width = (bytes[7] << 8) | bytes[8]
      // A height of 0 is legal (defined later by a DNL marker) but not checkable here.
      if (width === 0 || height === 0) return unknown('JPEG frame header does not declare its size')
      return { kind: 'known', size: { width, height } }
    }

    position += 2 + length
  }
  return unknown(`JPEG frame header not found within ${MAX_JPEG_SEGMENTS} segments`)
}

/** SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC). */
export function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function knownOrMalformed(width: number, height: number, format: string): DeclaredDimensions {
  if (width === 0 || height === 0) return malformed(`${format} declares a zero dimension`)
  return { kind: 'known', size: { width, height } }
}

function malformed(detail: string): DeclaredDimensions {
  return { kind: 'malformed', detail }
}

function unknown(detail: string): DeclaredDimensions {
  return { kind: 'unknown', detail }
}
