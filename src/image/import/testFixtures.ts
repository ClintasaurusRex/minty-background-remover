/*
 * Small deterministic byte fixtures for import tests. Only the header bytes that the
 * import pipeline inspects are realistic; image data is omitted.
 */

export function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values)
}

export function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function uint16be(value: number): Uint8Array<ArrayBuffer> {
  return bytes((value >>> 8) & 0xff, value & 0xff)
}

function uint32be(value: number): Uint8Array<ArrayBuffer> {
  return bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function uint16le(value: number): Uint8Array<ArrayBuffer> {
  return bytes(value & 0xff, (value >>> 8) & 0xff)
}

function uint24le(value: number): Uint8Array<ArrayBuffer> {
  return bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff)
}

function uint32le(value: number): Uint8Array<ArrayBuffer> {
  return bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

export const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** PNG signature and IHDR chunk (CRC omitted). */
export function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(PNG_SIGNATURE, uint32be(13), ascii('IHDR'), uint32be(width), uint32be(height), bytes(8, 6, 0, 0, 0))
}

/** The IEND chunk that ends every PNG, with its standard CRC. */
export const PNG_IEND = concat(uint32be(0), ascii('IEND'), bytes(0xae, 0x42, 0x60, 0x82))

/** A structurally complete (but not decodable) PNG: header, placeholder IHDR CRC, IEND. */
export function pngFile(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(pngHeader(width, height), uint32be(0), PNG_IEND)
}

function riff(chunk: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(ascii('RIFF'), uint32le(4 + 8 + payload.length), ascii('WEBP'), ascii(chunk), uint32le(payload.length), payload)
}

/** Lossy WebP: key-frame tag, start code, 14-bit width and height. */
export function webpVp8Header(width: number, height: number, { keyFrame = true } = {}): Uint8Array<ArrayBuffer> {
  return riff('VP8 ', concat(bytes(keyFrame ? 0x10 : 0x11, 0x02, 0x00), bytes(0x9d, 0x01, 0x2a), uint16le(width), uint16le(height)))
}

/** Lossless WebP: signature 0x2f, then (width − 1) and (height − 1) as packed 14-bit fields. */
export function webpVp8lHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  return riff('VP8L', concat(bytes(0x2f), uint32le(bits >>> 0)))
}

/** Extended WebP: flags, reserved, then (width − 1) and (height − 1) as 24-bit values. */
export function webpVp8xHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return riff('VP8X', concat(bytes(0x10, 0, 0, 0), uint24le(width - 1), uint24le(height - 1)))
}

/** A JPEG segment: FF, marker, big-endian length (including itself), payload. */
export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(bytes(0xff, marker), uint16be(payload.length + 2), payload)
}

/** SOF payload: precision, height, width, one component. */
export function jpegFrame(width: number, height: number, marker = 0xc0): Uint8Array<ArrayBuffer> {
  return jpegSegment(marker, concat(bytes(8), uint16be(height), uint16be(width), bytes(1, 1, 0x11, 0)))
}

export const JPEG_SOI = bytes(0xff, 0xd8)
export const JPEG_APP0 = jpegSegment(0xe0, concat(ascii('JFIF\0'), bytes(1, 1, 0, 0, 1, 0, 1, 0, 0)))

/** A plausible JPEG: SOI, JFIF, optional extra segments, SOF, then the start of scan. */
export function jpegFile(width: number, height: number, ...before: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat(JPEG_SOI, JPEG_APP0, ...before, jpegFrame(width, height), jpegSegment(0xda, bytes(1, 1, 0, 0, 0x3f, 0)))
}

/** Minimal ImageData-compatible object for Node, where ImageData does not exist. */
export function fakeImageData(width: number, height: number, dataLength = width * height * 4): ImageData {
  return { colorSpace: 'srgb', width, height, data: new Uint8ClampedArray(dataLength) }
}
