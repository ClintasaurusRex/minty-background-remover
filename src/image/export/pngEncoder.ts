import type { PixelBuffer } from '../../editor/types'
import { crc32End, crc32Start, crc32Update } from './crc32'

/*
 * PNG export (FEATURE_SPEC.md §22, IMAGE_PROCESSING_SPEC.md "PNG Export").
 *
 * The document's straight 8-bit RGBA pixels are written as they are: an 8-bit RGBA PNG (colour
 * type 6), not interlaced, with no ancillary chunks. Every byte of every visible pixel, partially
 * transparent ones included, decodes exactly as it is in the editor, and the size is the image's.
 * The one deliberate change: a fully transparent pixel is written as 0, 0, 0, 0, so colour that
 * Delete hid under alpha 0 (P3-D2) never leaves the application.
 *
 * A browser canvas encoder (toBlob, convertToBlob) is not used: canvases keep premultiplied colour,
 * which changes the colour of partially transparent pixels (anti-aliased and feathered edges) on
 * the way through.
 *
 * Compression is the platform's zlib (CompressionStream 'deflate', the zlib format PNG requires),
 * with each row filtered by the usual heuristic (the filter whose output has the smallest sum of
 * absolute signed bytes). The rows are filtered and compressed a slice at a time, waiting between
 * slices, so a large image never blocks the page for long; the pixels are read, never written.
 */

export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** Filtered bytes per slice of work by default, rounded down to whole rows (at least one). */
export const DEFAULT_SLICE_BYTES = 256 * 1024

export interface PngEncodeOptions {
  /**
   * Waited for between slices, so the page can respond and draw. By default one task of the event
   * loop (a MessageChannel message: unlike timers, not delayed by nesting or background-tab clamping).
   */
  readonly yieldControl?: () => Promise<void>
  /** Approximate filtered bytes per slice; whole rows, at least one. */
  readonly sliceBytes?: number
}

/**
 * `pixels` as a PNG file. Resolves once every row has been compressed; rejects, having written
 * nothing anywhere, if the browser cannot compress or allocate (for example for lack of memory).
 *
 * Peak memory beyond the pixels: the compressed file, two rows and one slice.
 */
export async function encodePng(pixels: PixelBuffer, options: PngEncodeOptions = {}): Promise<Blob> {
  const { width, height, data } = pixels
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid image size ${width} × ${height}`)
  }
  if (data.length !== width * height * 4 || data.byteOffset % 4 !== 0) {
    throw new RangeError('Pixel data does not match the image size')
  }
  const yieldControl = options.yieldControl ?? yieldToEventLoop
  const sliceBytes = options.sliceBytes ?? DEFAULT_SLICE_BYTES
  const stride = width * 4
  const rowsPerSlice = Math.max(1, Math.floor(sliceBytes / (stride + 1)))

  const parts: Uint8Array<ArrayBuffer>[] = [PNG_SIGNATURE, ...chunkParts('IHDR', headerData(width, height))]
  const compressor = new CompressionStream('deflate')
  const writer = compressor.writable.getWriter()
  const reader = compressor.readable.getReader()

  const readAll = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      parts.push(...chunkParts('IDAT', value))
    }
  }

  const writeAll = async () => {
    try {
      const source = new Uint32Array(data.buffer, data.byteOffset, width * height)
      let previous = new Uint8Array(stride)
      let current = new Uint8Array(stride)
      let previousEmpty = true
      for (let top = 0; top < height; top += rowsPerSlice) {
        const rows = Math.min(rowsPerSlice, height - top)
        // One byte (the filter type) and the filtered row, per row; zeros until written.
        const slice = new Uint8Array(rows * (stride + 1))
        for (let row = 0; row < rows; row++) {
          const empty = copyVisibleRow(source, (top + row) * width, width, current)
          // A row of 0 bytes is written unfiltered (already zeros): no filter can do better.
          if (!empty) filterRow(current, previous, previousEmpty, slice, row * (stride + 1))
          ;[previous, current] = [current, previous]
          previousEmpty = empty
        }
        await writer.write(slice)
        await yieldControl()
      }
      await writer.close()
    } catch (error) {
      await writer.abort(error).catch(() => {})
      throw error
    }
  }

  await Promise.all([writeAll(), readAll()])
  parts.push(...chunkParts('IEND', new Uint8Array(0)))
  return new Blob(parts, { type: 'image/png' })
}

/** One task of the event loop, so the page can handle input and draw. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** The alpha byte of a pixel read as a 32-bit word, on this platform's byte order. */
const ALPHA_MASK = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1 ? 0xff000000 : 0x000000ff

/**
 * Copies the `width` pixels starting at pixel `start` into `row`, writing fully transparent pixels
 * as 0, 0, 0, 0. Returns whether every byte of the row is then 0.
 */
function copyVisibleRow(source: Uint32Array, start: number, width: number, row: Uint8Array<ArrayBuffer>): boolean {
  const words = new Uint32Array(row.buffer, row.byteOffset, width)
  let any = 0
  for (let x = 0; x < width; x++) {
    const word = source[start + x]
    const visible = (word & ALPHA_MASK) === 0 ? 0 : word
    words[x] = visible
    any |= visible
  }
  return any === 0
}

/** PNG filter types (PNG specification §9.2). */
const NONE = 0
const SUB = 1
const UP = 2
const AVERAGE = 3
const PAETH = 4

/** Bytes per pixel: 8-bit RGBA. */
const BPP = 4

/**
 * |v| for a byte read as a signed value (v and 256 - v): the cost of one filtered byte in the filter
 * heuristic. A table lookup is faster than the comparison in V8 and SpiderMonkey.
 */
const SIGNED_SIZE = Uint8Array.from({ length: 256 }, (_, v) => (v < 128 ? v : 256 - v))

/**
 * Writes the filter type byte at `out[offset]` and the filtered `row` after it, choosing the filter
 * whose output has the smallest sum of absolute values as signed bytes (ties: the lower type).
 * `previous` is the row above, all zeros for the first row (`previousEmpty` says it is all zeros).
 */
function filterRow(
  row: Uint8Array,
  previous: Uint8Array,
  previousEmpty: boolean,
  out: Uint8Array,
  offset: number,
): void {
  const size = SIGNED_SIZE
  const length = row.length
  let none = 0
  let sub = 0
  let up = 0
  let average = 0
  let paeth: number
  if (previousEmpty) {
    // b = c = 0: Up is None, Paeth is Sub and Average uses a / 2.
    for (let i = 0; i < length; i++) {
      const x = row[i]
      const a = i >= BPP ? row[i - BPP] : 0
      none += size[x]
      sub += size[(x - a) & 255]
      average += size[(x - (a >> 1)) & 255]
    }
    up = none
    paeth = sub
  } else {
    for (let i = 0; i < BPP; i++) {
      // a = c = 0: Sub is None and Paeth predicts b.
      const x = row[i]
      const b = previous[i]
      none += size[x]
      up += size[(x - b) & 255]
      average += size[(x - (b >> 1)) & 255]
    }
    sub = none
    paeth = up
    for (let i = BPP; i < length; i++) {
      const x = row[i]
      const a = row[i - BPP]
      const b = previous[i]
      const c = previous[i - BPP]
      none += size[x]
      sub += size[(x - a) & 255]
      up += size[(x - b) & 255]
      average += size[(x - ((a + b) >> 1)) & 255]
      // The Paeth predictor (PNG specification §9.4): whichever of a, b, c is closest to a + b - c.
      const pa = Math.abs(b - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + b - 2 * c)
      paeth += size[(x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255]
    }
  }

  let filter = NONE
  let best = none
  if (sub < best) {
    filter = SUB
    best = sub
  }
  if (up < best) {
    filter = UP
    best = up
  }
  if (average < best) {
    filter = AVERAGE
    best = average
  }
  if (paeth < best) filter = PAETH

  out[offset] = filter
  const o = offset + 1
  // Out is a Uint8Array: every value is stored modulo 256, as filtering requires. The first pixel
  // has no left neighbour (a = c = 0).
  switch (filter) {
    case NONE:
      out.set(row, o)
      return
    case SUB:
      for (let i = 0; i < BPP; i++) out[o + i] = row[i]
      for (let i = BPP; i < length; i++) out[o + i] = row[i] - row[i - BPP]
      return
    case UP:
      for (let i = 0; i < length; i++) out[o + i] = row[i] - previous[i]
      return
    case AVERAGE:
      for (let i = 0; i < BPP; i++) out[o + i] = row[i] - (previous[i] >> 1)
      for (let i = BPP; i < length; i++) out[o + i] = row[i] - ((row[i - BPP] + previous[i]) >> 1)
      return
    case PAETH:
      for (let i = 0; i < BPP; i++) out[o + i] = row[i] - previous[i]
      for (let i = BPP; i < length; i++) {
        const a = row[i - BPP]
        const b = previous[i]
        const c = previous[i - BPP]
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        out[o + i] = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      return
  }
}

/** IHDR: size, 8-bit RGBA, deflate, adaptive filtering, not interlaced. */
function headerData(width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // compression method, filter method and interlace method all 0
  return header
}

/** PNG chunks hold at most 2^31 - 1 bytes; IDAT data is split if ever larger. */
const MAX_CHUNK_DATA = 0x7fffffff

/**
 * The parts of one chunk of `type` holding `data` (more than one chunk if `data` is too long):
 * its length and type, the data itself (not copied) and its CRC.
 */
function chunkParts(type: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let start = 0
  do {
    const piece = data.subarray(start, Math.min(data.length, start + MAX_CHUNK_DATA))
    const head = new Uint8Array(8)
    const headView = new DataView(head.buffer)
    headView.setUint32(0, piece.length)
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i)
    const tail = new Uint8Array(4)
    new DataView(tail.buffer).setUint32(0, crc32End(crc32Update(crc32Update(crc32Start(), head.subarray(4)), piece)))
    parts.push(head, piece, tail)
    start += piece.length
  } while (start < data.length)
  return parts
}
