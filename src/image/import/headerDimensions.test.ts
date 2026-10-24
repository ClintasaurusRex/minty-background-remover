import { describe, expect, it } from 'vitest'
import {
  MAX_JPEG_SEGMENTS,
  isStartOfFrame,
  parsePngDimensions,
  parseWebpDimensions,
  readDeclaredDimensions,
  readJpegDimensions,
} from './headerDimensions'
import {
  JPEG_APP0,
  JPEG_SOI,
  bytes,
  concat,
  jpegFile,
  jpegFrame,
  jpegSegment,
  pngHeader,
  webpVp8Header,
  webpVp8lHeader,
  webpVp8xHeader,
} from './testFixtures'

const blob = (data: Uint8Array<ArrayBuffer>) => new Blob([data])

describe('parsePngDimensions', () => {
  it('reads width and height from IHDR', () => {
    expect(parsePngDimensions(pngHeader(1920, 1080))).toEqual({ kind: 'known', size: { width: 1920, height: 1080 } })
    expect(parsePngDimensions(pngHeader(1, 1))).toEqual({ kind: 'known', size: { width: 1, height: 1 } })
  })

  it('reads full 32-bit dimensions so huge declared sizes can be rejected', () => {
    expect(parsePngDimensions(pngHeader(0x7fffffff, 100_000))).toEqual({
      kind: 'known',
      size: { width: 0x7fffffff, height: 100_000 },
    })
    expect(parsePngDimensions(pngHeader(0xffffffff, 1))).toMatchObject({ size: { width: 0xffffffff } })
  })

  it('rejects truncated headers, a missing IHDR and zero dimensions', () => {
    expect(parsePngDimensions(pngHeader(10, 10).subarray(0, 23)).kind).toBe('malformed')
    const notIhdr = pngHeader(10, 10)
    notIhdr.set([0x49, 0x44, 0x41, 0x54], 12) // "IDAT"
    expect(parsePngDimensions(notIhdr).kind).toBe('malformed')
    expect(parsePngDimensions(pngHeader(0, 10)).kind).toBe('malformed')
    expect(parsePngDimensions(pngHeader(10, 0)).kind).toBe('malformed')
  })
})

describe('parseWebpDimensions', () => {
  it('reads lossy (VP8) dimensions', () => {
    expect(parseWebpDimensions(webpVp8Header(800, 600))).toEqual({ kind: 'known', size: { width: 800, height: 600 } })
    expect(parseWebpDimensions(webpVp8Header(16383, 1))).toMatchObject({ size: { width: 16383, height: 1 } })
  })

  it('ignores the VP8 scaling bits', () => {
    const header = webpVp8Header(800, 600)
    header[27] |= 0xc0 // horizontal scale flags
    expect(parseWebpDimensions(header)).toMatchObject({ size: { width: 800, height: 600 } })
  })

  it('reads lossless (VP8L) dimensions', () => {
    expect(parseWebpDimensions(webpVp8lHeader(1, 1))).toMatchObject({ size: { width: 1, height: 1 } })
    expect(parseWebpDimensions(webpVp8lHeader(3840, 2160))).toMatchObject({ size: { width: 3840, height: 2160 } })
    expect(parseWebpDimensions(webpVp8lHeader(16384, 16384))).toMatchObject({ size: { width: 16384, height: 16384 } })
  })

  it('reads extended (VP8X) canvas dimensions, including sizes beyond the limits', () => {
    expect(parseWebpDimensions(webpVp8xHeader(640, 480))).toMatchObject({ size: { width: 640, height: 480 } })
    expect(parseWebpDimensions(webpVp8xHeader(2 ** 24, 2 ** 24))).toMatchObject({
      size: { width: 2 ** 24, height: 2 ** 24 },
    })
  })

  it('rejects truncated and invalid headers', () => {
    expect(parseWebpDimensions(webpVp8Header(10, 10).subarray(0, 29)).kind).toBe('malformed')
    expect(parseWebpDimensions(webpVp8lHeader(10, 10).subarray(0, 24)).kind).toBe('malformed')
    expect(parseWebpDimensions(webpVp8xHeader(10, 10).subarray(0, 29)).kind).toBe('malformed')
    expect(parseWebpDimensions(webpVp8Header(10, 10).subarray(0, 15)).kind).toBe('malformed')
    expect(parseWebpDimensions(webpVp8Header(10, 10, { keyFrame: false })).kind).toBe('malformed')
    expect(parseWebpDimensions(webpVp8Header(0, 10)).kind).toBe('malformed')

    const badStartCode = webpVp8Header(10, 10)
    badStartCode[24] = 0
    expect(parseWebpDimensions(badStartCode).kind).toBe('malformed')

    const badSignature = webpVp8lHeader(10, 10)
    badSignature[20] = 0
    expect(parseWebpDimensions(badSignature).kind).toBe('malformed')

    const unknownChunk = webpVp8xHeader(10, 10)
    unknownChunk.set([0x41, 0x4c, 0x50, 0x48], 12) // "ALPH" may not come first
    expect(parseWebpDimensions(unknownChunk).kind).toBe('malformed')
  })
})

describe('readJpegDimensions', () => {
  it('reads baseline and progressive frame headers', async () => {
    expect(await readJpegDimensions(blob(jpegFile(1920, 1080)))).toEqual({
      kind: 'known',
      size: { width: 1920, height: 1080 },
    })
    const progressive = concat(JPEG_SOI, JPEG_APP0, jpegFrame(640, 480, 0xc2))
    expect(await readJpegDimensions(blob(progressive))).toMatchObject({ size: { width: 640, height: 480 } })
  })

  it('skips large EXIF and ICC segments before the frame header', async () => {
    const exif = jpegSegment(0xe1, new Uint8Array(65_533)) // maximum segment size
    const icc = Array.from({ length: 20 }, () => jpegSegment(0xe2, new Uint8Array(60_000)))
    const file = jpegFile(4000, 3000, exif, ...icc)
    expect(file.length).toBeGreaterThan(1_000_000)
    expect(await readJpegDimensions(blob(file))).toMatchObject({ size: { width: 4000, height: 3000 } })
  })

  it('skips tables, comments, fill bytes and standalone markers', async () => {
    const file = jpegFile(
      100,
      50,
      jpegSegment(0xdb, new Uint8Array(65)), // DQT
      jpegSegment(0xc4, new Uint8Array(30)), // DHT is not a frame header
      jpegSegment(0xfe, new Uint8Array(10)), // COM
      bytes(0xff, 0xff), // fill bytes
      bytes(0xff, 0x01), // TEM
    )
    expect(await readJpegDimensions(blob(file))).toMatchObject({ size: { width: 100, height: 50 } })
  })

  it('reads the declared size even when it exceeds the limits', async () => {
    expect(await readJpegDimensions(blob(jpegFile(65_535, 65_535)))).toMatchObject({
      size: { width: 65_535, height: 65_535 },
    })
  })

  it('reports unknown rather than malformed for structural problems browsers may tolerate', async () => {
    const cases = [
      JPEG_SOI, // ends immediately
      concat(JPEG_SOI, JPEG_APP0), // no frame header
      concat(JPEG_SOI, JPEG_APP0, bytes(0x00, 0x00, 0x00)), // garbage instead of a marker
      concat(JPEG_SOI, jpegSegment(0xda, bytes(1)), jpegFrame(10, 10)), // scan before frame
      concat(JPEG_SOI, bytes(0xff, 0xe0, 0x00, 0x01)), // invalid segment length
      concat(JPEG_SOI, jpegFrame(10, 10).subarray(0, 7)), // truncated frame header
      concat(JPEG_SOI, jpegFrame(10, 0)), // height defined later by DNL
    ]
    for (const file of cases) {
      expect((await readJpegDimensions(blob(file))).kind).toBe('unknown')
    }
  })

  it('stops after a bounded number of segments', async () => {
    const comments = Array.from({ length: MAX_JPEG_SEGMENTS }, () => jpegSegment(0xfe, bytes(0)))
    const file = concat(JPEG_SOI, ...comments, jpegFrame(10, 10))
    expect((await readJpegDimensions(blob(file))).kind).toBe('unknown')
  })

  it('reads only segment headers, not segment contents', async () => {
    const exif = jpegSegment(0xe1, new Uint8Array(65_533))
    const data = jpegFile(10, 10, exif)
    const real = blob(data)
    let bytesRequested = 0
    const spy = {
      size: real.size,
      slice: (start: number, end: number) => {
        bytesRequested += end - start
        return real.slice(start, end)
      },
    } as unknown as Blob
    await readJpegDimensions(spy)
    expect(bytesRequested).toBeLessThan(64)
  })
})

describe('isStartOfFrame', () => {
  it('matches SOF0–SOF15 except DHT, JPG and DAC', () => {
    const sof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
    for (let marker = 0; marker <= 0xff; marker++) {
      expect(isStartOfFrame(marker)).toBe(sof.includes(marker))
    }
  })
})

describe('readDeclaredDimensions', () => {
  it('dispatches by format', async () => {
    expect(await readDeclaredDimensions(blob(pngHeader(12, 34)), 'png')).toMatchObject({ size: { width: 12, height: 34 } })
    expect(await readDeclaredDimensions(blob(webpVp8lHeader(56, 78)), 'webp')).toMatchObject({ size: { width: 56, height: 78 } })
    expect(await readDeclaredDimensions(blob(jpegFile(90, 12)), 'jpeg')).toMatchObject({ size: { width: 90, height: 12 } })
  })
})
