import type { Rectangle, SelectionMask } from '../types'
import { validateDimensions, validateRectangleWithin } from './geometry'

/*
 * Compact copies of selection masks, so that Undo can restore the selection from before an
 * edit (P3-D3) without keeping one byte per image pixel.
 *
 * Only the selection's bounds are stored, in one of two forms, whichever is smaller:
 *
 * - 'runs':  the lengths of alternating unselected and selected runs over the bounds in row
 *            order (a run may continue onto the next row), starting with unselected (which
 *            may be 0 long), each as an unsigned LEB128 varint: 1 byte up to 127, 2 bytes up
 *            to 16,383 and so on. Small for the smooth shapes the Magic Wand usually makes.
 * - 'bits':  one bit per pixel of the bounds in row order, lowest bit first. Never more than
 *            an eighth of the bounds' size, so noisy selections stay bounded.
 *
 * Encoded selections share no memory with masks, are never modified once created, and do
 * not refer to documents or revisions.
 */

export interface EncodedSelection {
  readonly kind: 'selection'
  /** Size of the image the selection belongs to. */
  readonly width: number
  readonly height: number
  /** Number of selected pixels. At least 1. */
  readonly count: number
  /** Smallest rectangle containing every selected pixel. */
  readonly bounds: Readonly<Rectangle>
  readonly format: 'runs' | 'bits'
  readonly data: Uint8Array
}

/** The longest varint accepted: 8 bytes, 56 bits, far beyond any image. */
const MAX_VARINT_BYTES = 8
const INITIAL_CAPACITY = 1024

/**
 * A compact copy of `selection`, or null for no selection. The mask is not written, and
 * the result shares no memory with it. Allocates only the result (plus, for runs, a
 * buffer that grows by doubling and is trimmed): never more than an eighth of the
 * bounds' size in bytes.
 *
 * Throws a RangeError for a mask whose data or bounds do not fit its size.
 */
export function encodeSelection(selection: SelectionMask | null): EncodedSelection | null {
  if (!selection) return null
  const { width, height, data, count } = selection
  validateDimensions(width, height, 'selection')
  if (data.length !== width * height) {
    throw new RangeError(`Selection has ${data.length} entries; expected ${width * height}`)
  }
  const bounds: Rectangle = { ...selection.bounds }
  validateRectangleWithin(bounds, width, height, 'Selection bounds')

  const bitBytes = Math.ceil((bounds.width * bounds.height) / 8)
  const runs = encodeRuns(data, width, bounds, bitBytes)
  return runs
    ? { kind: 'selection', width, height, count, bounds, format: 'runs', data: runs }
    : { kind: 'selection', width, height, count, bounds, format: 'bits', data: packBits(data, width, bounds, bitBytes) }
}

/**
 * The selection `encoded` was made from, as a new mask that the caller owns (null for null).
 * Its count and bounds are checked against the decoded pixels.
 *
 * Throws a RangeError for malformed data. Allocates the mask (one byte per image pixel) and
 * nothing else.
 */
export function decodeSelection(encoded: EncodedSelection | null): SelectionMask | null {
  if (!encoded) return null
  if (encoded.kind !== 'selection') throw new RangeError(`Not an encoded selection: ${String(encoded.kind)}`)
  const { width, height, bounds } = encoded
  validateDimensions(width, height, 'selection')
  validateRectangleWithin(bounds, width, height, 'Selection bounds')
  const area = bounds.width * bounds.height
  if (!Number.isSafeInteger(encoded.count) || encoded.count < 1 || encoded.count > area) {
    throw new RangeError(`Invalid selected pixel count ${encoded.count} for bounds of ${area} pixels`)
  }
  if (encoded.format !== 'bits' && encoded.format !== 'runs') {
    throw new RangeError(`Unknown selection format: ${String(encoded.format)}`)
  }
  if (encoded.format === 'bits' && encoded.data.length !== Math.ceil(area / 8)) {
    throw new RangeError(`Packed selection has ${encoded.data.length} bytes; expected ${Math.ceil(area / 8)}`)
  }

  const data = new Uint8Array(width * height)
  const found = encoded.format === 'runs' ? decodeRuns(encoded.data, data, width, bounds) : unpackBits(encoded.data, data, width, bounds)
  if (found.count !== encoded.count) {
    throw new RangeError(`Decoded ${found.count} selected pixels; expected ${encoded.count}`)
  }
  const { x, y, width: w, height: h } = found.bounds
  if (x !== bounds.x || y !== bounds.y || w !== bounds.width || h !== bounds.height) {
    throw new RangeError('Decoded selection does not fill its recorded bounds')
  }
  return { width, height, data, count: found.count, bounds: { ...bounds } }
}

/**
 * Run lengths over the bounds as varints, or null as soon as they would take more than
 * `limit` bytes (then packed bits are smaller).
 */
function encodeRuns(mask: Readonly<Uint8Array>, width: number, bounds: Rectangle, limit: number): Uint8Array | null {
  let out = new Uint8Array(Math.min(INITIAL_CAPACITY, limit))
  let used = 0
  /** Appends `value` as a varint; false when that would pass the limit. */
  const write = (value: number): boolean => {
    let bytes = 1
    for (let v = value; v > 0x7f; v = Math.floor(v / 128)) bytes++
    if (used + bytes > limit) return false
    if (used + bytes > out.length) {
      const grown = new Uint8Array(Math.min(Math.max(out.length * 2, used + bytes), limit))
      grown.set(out.subarray(0, used))
      out = grown
    }
    let v = value
    while (v > 0x7f) {
      out[used++] = (v % 128) | 0x80
      v = Math.floor(v / 128)
    }
    out[used++] = v
    return true
  }

  let current = 0
  let length = 0
  const right = bounds.x + bounds.width
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const rowStart = y * width
    for (let i = rowStart + bounds.x, end = rowStart + right; i < end; i++) {
      if (mask[i] === current) {
        length++
        continue
      }
      if (!write(length)) return null
      current = mask[i]
      length = 1
    }
  }
  if (!write(length)) return null
  return used === out.length ? out : out.slice(0, used)
}

function packBits(mask: Readonly<Uint8Array>, width: number, bounds: Rectangle, byteLength: number): Uint8Array {
  const bits = new Uint8Array(byteLength)
  let k = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const rowStart = y * width
    for (let i = rowStart + bounds.x, end = i + bounds.width; i < end; i++, k++) {
      if (mask[i] !== 0) bits[k >> 3] |= 1 << (k & 7)
    }
  }
  return bits
}

interface Decoded {
  count: number
  bounds: Rectangle
}

/** Tracks the selected pixels written while decoding: their count and bounds. */
class SelectedExtent {
  count = 0
  minX = Infinity
  maxX = -1
  minY = Infinity
  maxY = -1

  /** Records `count` selected pixels in row `y`, the first in column `first` and the last in `last`. */
  add(first: number, last: number, y: number, count: number): void {
    this.count += count
    if (first < this.minX) this.minX = first
    if (last > this.maxX) this.maxX = last
    if (y < this.minY) this.minY = y
    if (y > this.maxY) this.maxY = y
  }

  result(): Decoded {
    return {
      count: this.count,
      bounds: this.count === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: this.minX, y: this.minY, width: this.maxX - this.minX + 1, height: this.maxY - this.minY + 1 },
    }
  }
}

function decodeRuns(encoded: Readonly<Uint8Array>, mask: Uint8Array, width: number, bounds: Rectangle): Decoded {
  const area = bounds.width * bounds.height
  const extent = new SelectedExtent()
  let position = 0
  let selected = false
  let at = 0
  let first = true
  while (at < encoded.length) {
    // One varint, never longer than what is left of the bounds.
    let length = 0
    let scale = 1
    let bytes = 0
    for (;;) {
      if (at >= encoded.length) throw new RangeError('Selection runs end inside a number')
      const byte = encoded[at++]
      length += (byte & 0x7f) * scale
      scale *= 128
      if (++bytes > MAX_VARINT_BYTES || length > area - position) {
        throw new RangeError('Selection run is longer than its bounds')
      }
      if (byte < 0x80) break
    }
    if (length === 0 && !first) throw new RangeError('Selection run of length 0')
    first = false

    if (selected) {
      // Fill row by row: a run may continue onto the next row.
      let left = length
      let p = position
      while (left > 0) {
        const row = Math.floor(p / bounds.width)
        const column = p - row * bounds.width
        const segment = Math.min(left, bounds.width - column)
        const x = bounds.x + column
        const y = bounds.y + row
        mask.fill(1, y * width + x, y * width + x + segment)
        extent.add(x, x + segment - 1, y, segment)
        p += segment
        left -= segment
      }
    }
    position += length
    selected = !selected
  }
  if (position !== area) throw new RangeError(`Selection runs cover ${position} pixels; expected ${area}`)
  return extent.result()
}

function unpackBits(bits: Readonly<Uint8Array>, mask: Uint8Array, width: number, bounds: Rectangle): Decoded {
  const area = bounds.width * bounds.height
  // Padding bits after the last pixel must be 0, so each selection has one encoding.
  if (area % 8 !== 0 && bits[bits.length - 1] >> (area % 8) !== 0) {
    throw new RangeError('Packed selection has bits set beyond its bounds')
  }
  const extent = new SelectedExtent()
  let k = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const rowStart = y * width
    let first = -1
    let last = -1
    let count = 0
    for (let x = bounds.x, end = x + bounds.width; x < end; x++, k++) {
      if ((bits[k >> 3] >> (k & 7)) & 1) {
        mask[rowStart + x] = 1
        if (first < 0) first = x
        last = x
        count++
      }
    }
    if (count > 0) extent.add(first, last, y, count)
  }
  return extent.result()
}
