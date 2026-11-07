// A minimal PNG encoder (8-bit RGBA, no filtering) for generated fixtures: exact pixels,
// including colour under alpha 0, which a browser's canvas encoder would not keep. And a minimal
// decoder for 8-bit RGBA / RGB PNGs, to read reference images.
import zlib from 'node:zlib'

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

/** Straight (non-premultiplied) RGBA bytes, row by row, to a PNG file's bytes. */
export function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    // Each row starts with filter type 0 (none).
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Decodes an 8-bit, non-interlaced RGBA or RGB PNG (as Node and simple encoders write them) to
 * straight RGBA bytes: { width, height, data }. Other kinds throw.
 */
export function decodePng(bytes) {
  const buffer = Buffer.from(bytes)
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colour, , , interlace] = body.subarray(8, 13)
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0
      if (depth !== 8 || !channels || interlace) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`)
    } else if (type === 'IDAT') idat.push(body)
    offset += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? rows[out + i - channels] : 0
      const b = y > 0 ? rows[out - stride + i] : 0
      const c = y > 0 && i >= channels ? rows[out - stride + i - channels] : 0
      let value = line[i]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      rows[out + i] = value & 255
    }
  }
  if (channels === 4) return { width, height, data: rows }
  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = rows[p * 3]
    data[p * 4 + 1] = rows[p * 3 + 1]
    data[p * 4 + 2] = rows[p * 3 + 2]
    data[p * 4 + 3] = 255
  }
  return { width, height, data }
}
