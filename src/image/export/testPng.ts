/*
 * A PNG reader for tests, written independently of the encoder: it checks the file's structure
 * and every chunk's CRC (bit by bit, not with the encoder's table), inflates the image data with the
 * platform's DecompressionStream, which also checks zlib's Adler-32, and reverses each row's filter.
 * Only what the encoder writes is supported: 8-bit RGBA, not interlaced.
 */

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** Straight RGBA bytes, row by row. */
  readonly data: Uint8Array
  /** Chunk types in file order. */
  readonly chunks: readonly string[]
  /** The IHDR fields after width and height: bit depth, colour type, compression, filter, interlace. */
  readonly header: readonly number[]
  /** Each row's filter type. */
  readonly filters: readonly number[]
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export async function decodeTestPng(file: Blob): Promise<DecodedPng> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer)
  SIGNATURE.forEach((value, i) => {
    if (bytes[i] !== value) throw new Error(`Bad PNG signature at byte ${i}`)
  })
  const chunks: string[] = []
  const idat: Uint8Array<ArrayBuffer>[] = []
  let header: number[] = []
  let width = 0
  let height = 0
  let offset = 8
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated chunk')
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const end = offset + 8 + length
    if (end + 4 > bytes.length) throw new Error(`Truncated ${type} chunk`)
    const expected = view.getUint32(end)
    const actual = bitwiseCrc32(bytes.subarray(offset + 4, end))
    if (expected !== actual) throw new Error(`Bad CRC in ${type} chunk`)
    const body = bytes.subarray(offset + 8, end)
    if (type === 'IHDR') {
      const ihdr = new DataView(body.buffer, body.byteOffset, body.length)
      width = ihdr.getUint32(0)
      height = ihdr.getUint32(4)
      header = [...body.subarray(8, 13)]
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    chunks.push(type)
    offset = end + 4
  }
  if (chunks[0] !== 'IHDR' || chunks.at(-1) !== 'IEND') throw new Error(`Bad chunk order: ${chunks.join(', ')}`)
  if (header.join() !== '8,6,0,0,0') throw new Error(`Unsupported PNG header ${header.join()}`)

  const raw = await inflate(idat)
  const stride = width * 4
  if (raw.length !== height * (stride + 1)) throw new Error(`Image data is ${raw.length} bytes, expected ${height * (stride + 1)}`)
  const data = new Uint8Array(height * stride)
  const filters: number[] = []
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    filters.push(filter)
    const line = y * (stride + 1) + 1
    const out = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? data[out + i - 4] : 0
      const b = y > 0 ? data[out - stride + i] : 0
      const c = y > 0 && i >= 4 ? data[out - stride + i - 4] : 0
      let predicted
      if (filter === 0) predicted = 0
      else if (filter === 1) predicted = a
      else if (filter === 2) predicted = b
      else if (filter === 3) predicted = Math.floor((a + b) / 2)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else throw new Error(`Bad filter type ${filter} on row ${y}`)
      data[out + i] = (raw[line + i] + predicted) % 256
    }
  }
  return { width, height, data, chunks, header, filters }
}

async function inflate(pieces: Uint8Array<ArrayBuffer>[]): Promise<Uint8Array> {
  const stream = new Blob(pieces).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** CRC-32 computed bit by bit, as a reference independent of the encoder's table. */
export function bitwiseCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
