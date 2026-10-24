import { describe, expect, it } from 'vitest'
import type { Size } from '../../editor/types'
import type { DecodedSource, ImportDecoder, RasterFormat } from './decoder'
import { ImportFailure, createImportError } from './errors'
import { type ImportRequest, importImage } from './importImage'
import { DEFAULT_IMPORT_LIMITS } from './limits'
import { SVG_NAMESPACE, type ParsedSvg, type SvgElementLike } from './svgSafety'
import { ascii, concat, fakeImageData, jpegFile, pngFile, pngHeader, webpVp8lHeader, JPEG_APP0, JPEG_SOI, PNG_IEND } from './testFixtures'

interface FakeDecoderOptions {
  /** Size the fake raster decoder reports; defaults to 4 × 3. */
  rasterSize?: Size
  /** Parsed trees by markup; markup not listed is treated as malformed XML. */
  svgTrees?: Record<string, ParsedSvg>
  decodeRaster?: ImportDecoder['decodeRaster']
  toImageData?: (size: Size) => ImageData
}

function fakeDecoder(options: FakeDecoderOptions = {}) {
  const calls = {
    decodeRaster: [] as RasterFormat[],
    parseSvg: [] as string[],
    rasteriseSvg: [] as Size[],
    toImageData: 0,
    release: 0,
  }

  const source = (size: Size): DecodedSource => ({
    ...size,
    toImageData: () => {
      calls.toImageData++
      return (options.toImageData ?? ((s) => fakeImageData(s.width, s.height)))(size)
    },
    release: () => {
      calls.release++
    },
  })

  const decoder: ImportDecoder = {
    decodeRaster: async (blob, format) => {
      calls.decodeRaster.push(format)
      if (options.decodeRaster) return options.decodeRaster(blob, format)
      return source(options.rasterSize ?? { width: 4, height: 3 })
    },
    parseSvg: (markup) => {
      calls.parseSvg.push(markup)
      return options.svgTrees?.[markup] ?? null
    },
    rasteriseSvg: async (_svg, size) => {
      calls.rasteriseSvg.push(size)
      return source(size)
    },
  }
  return { decoder, calls, source }
}

function svgRoot(attributes: Record<string, string>, children: SvgElementLike[] = []): ParsedSvg {
  return {
    root: {
      localName: 'svg',
      namespaceURI: SVG_NAMESPACE,
      textContent: null,
      children,
      getAttributeNames: () => Object.keys(attributes),
      getAttribute: (name) => attributes[name] ?? null,
    },
    processingInstructions: [],
    hasDoctype: false,
  }
}

function request(content: BlobPart[], name = 'image', source: ImportRequest['source'] = 'file-picker'): ImportRequest {
  return { blob: new File(content, name), name, source }
}

const PNG = pngFile(4, 3)
const SVG_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"></svg>'

describe('importImage: raster formats', () => {
  it('decodes a PNG into a document with the decoded dimensions', async () => {
    const { decoder, calls } = fakeDecoder()
    const result = await importImage(request([PNG], 'pump-station.png'), { decoder })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document).toMatchObject({
      name: 'pump-station.png',
      format: 'png',
      source: 'file-picker',
      fileSizeBytes: PNG.length,
      width: 4,
      height: 3,
      revision: 0,
    })
    expect(result.document.pixels.width).toBe(4)
    expect(result.document.pixels.height).toBe(3)
    expect(calls.decodeRaster).toEqual(['png'])
    expect(calls.parseSvg).toEqual([])
    expect(calls.release).toBe(1)
  })

  it('selects the decoder from content, not the file name', async () => {
    const cases: [Uint8Array<ArrayBuffer>, string, RasterFormat][] = [
      [jpegFile(4, 3), 'photo.png', 'jpeg'],
      [webpVp8lHeader(4, 3), 'photo.jpg', 'webp'],
      [PNG, 'image.webp', 'png'],
    ]
    for (const [content, name, format] of cases) {
      const { decoder, calls } = fakeDecoder()
      const result = await importImage(request([content], name, 'drop'), { decoder })
      expect(result.ok && result.document.format).toBe(format)
      expect(calls.decodeRaster).toEqual([format])
    }
  })

  it('records the import source', async () => {
    const { decoder } = fakeDecoder()
    const result = await importImage(request([PNG], 'Pasted image', 'paste'), { decoder })
    expect(result.ok && result.document.source).toBe('paste')
  })

  it('uses the decoded size, which may differ from the header after EXIF rotation', async () => {
    const { decoder } = fakeDecoder({ rasterSize: { width: 3000, height: 4000 } })
    const result = await importImage(request([jpegFile(4000, 3000)]), { decoder })
    expect(result.ok && [result.document.width, result.document.height]).toEqual([3000, 4000])
  })

  it('gives each document a new id', async () => {
    const { decoder } = fakeDecoder()
    const first = await importImage(request([PNG]), { decoder })
    const second = await importImage(request([PNG]), { decoder })
    expect(first.ok && second.ok && second.document.id > first.document.id).toBe(true)
  })
})

describe('importImage: rejected before decoding', () => {
  it('rejects unsupported and empty files without calling the decoder', async () => {
    const { decoder, calls } = fakeDecoder()
    const gif = await importImage(request([ascii('GIF89a\x01\x00\x01\x00')], 'a.png'), { decoder })
    expect(!gif.ok && gif.error.code).toBe('unsupported-format')

    const empty = await importImage(request([], 'a.png'), { decoder })
    expect(!empty.ok && empty.error.code).toBe('decode-failed')
    expect(calls.decodeRaster).toEqual([])
  })

  it('rejects files over the size limit', async () => {
    const { decoder, calls } = fakeDecoder()
    const limits = { ...DEFAULT_IMPORT_LIMITS, maxFileBytes: PNG.length - 1 }
    const result = await importImage(request([PNG]), { decoder, limits })
    expect(!result.ok && result.error.code).toBe('file-too-large')
    expect(calls.decodeRaster).toEqual([])
  })

  it('rejects declared dimensions over the limits from the header alone', async () => {
    const oversized = [
      pngHeader(16_385, 1),
      pngHeader(8000, 8000), // 64 MP
      pngHeader(0xffffffff, 0xffffffff),
      webpVp8lHeader(16_384, 16_384),
      jpegFile(10_000, 5_001),
    ]
    for (const content of oversized) {
      const { decoder, calls } = fakeDecoder()
      const result = await importImage(request([content]), { decoder })
      expect(!result.ok && result.error.code).toBe('dimensions-too-large')
      expect(calls.decodeRaster).toEqual([])
    }
  })

  it('accepts declared dimensions exactly at the limits', async () => {
    const { decoder, calls } = fakeDecoder()
    const result = await importImage(request([pngFile(10_000, 5_000)]), { decoder })
    expect(result.ok).toBe(true)
    expect(calls.decodeRaster).toEqual(['png'])
  })

  it('rejects malformed PNG and WebP headers without decoding', async () => {
    const noIhdr = pngHeader(4, 3)
    noIhdr.set(ascii('IDAT'), 12)
    for (const content of [noIhdr, pngHeader(4, 3).subarray(0, 20), pngHeader(0, 3), concat(webpVp8lHeader(4, 3).subarray(0, 12), ascii('ALPH'))]) {
      const { decoder, calls } = fakeDecoder()
      const result = await importImage(request([content]), { decoder })
      expect(!result.ok && result.error.code).toBe('decode-failed')
      expect(calls.decodeRaster).toEqual([])
    }
  })
})

describe('importImage: PNG ending', () => {
  it('rejects a truncated PNG without decoding it', async () => {
    const truncated = pngFile(4, 3).subarray(0, -6)
    const { decoder, calls } = fakeDecoder()
    const result = await importImage(request([truncated]), { decoder })
    expect(!result.ok && result.error.code).toBe('decode-failed')
    expect(!result.ok && result.error.detail).toMatch(/truncated/)
    expect(calls.decodeRaster).toEqual([])
  })

  it('reports an over-size PNG as too large even when it is also truncated', async () => {
    const { decoder } = fakeDecoder()
    const result = await importImage(request([pngHeader(20_000, 10)]), { decoder })
    expect(!result.ok && result.error.code).toBe('dimensions-too-large')
  })

  it('does not apply the PNG ending check to other formats', async () => {
    const { decoder, calls } = fakeDecoder()
    await importImage(request([concat(jpegFile(4, 3), PNG_IEND.subarray(0, 4))]), { decoder })
    expect(calls.decodeRaster).toEqual(['jpeg'])
  })
})

describe('importImage: checked after decoding', () => {
  it('decodes a JPEG whose header size cannot be read, then checks the decoded size', async () => {
    const noFrameHeader = concat(JPEG_SOI, JPEG_APP0)
    const { decoder, calls } = fakeDecoder({ rasterSize: { width: 20_000, height: 20_000 } })
    const result = await importImage(request([noFrameHeader]), { decoder })

    expect(calls.decodeRaster).toEqual(['jpeg'])
    expect(!result.ok && result.error.code).toBe('dimensions-too-large')
    expect(calls.toImageData).toBe(0) // the RGBA buffer is never allocated
    expect(calls.release).toBe(1)
  })

  it('rejects invalid decoded dimensions', async () => {
    for (const rasterSize of [{ width: 0, height: 3 }, { width: Number.NaN, height: 3 }]) {
      const { decoder, calls } = fakeDecoder({ rasterSize })
      const result = await importImage(request([concat(JPEG_SOI, JPEG_APP0)]), { decoder })
      expect(!result.ok && result.error.code).toBe('decode-failed')
      expect(calls.release).toBe(1)
    }
  })

  it('rejects pixels whose size does not match the decoded size', async () => {
    const { decoder, calls } = fakeDecoder({ toImageData: () => fakeImageData(3, 4) })
    const result = await importImage(request([PNG]), { decoder })
    expect(!result.ok && result.error.code).toBe('decode-failed')
    expect(calls.release).toBe(1)
  })

  it('rejects an incomplete pixel buffer', async () => {
    const { decoder, calls } = fakeDecoder({ toImageData: (s) => fakeImageData(s.width, s.height, 10) })
    const result = await importImage(request([PNG]), { decoder })
    expect(!result.ok && result.error.code).toBe('decode-failed')
    expect(calls.release).toBe(1)
  })
})

describe('importImage: decoder failures', () => {
  it('maps decoder exceptions to decode-failed with the cause as detail', async () => {
    const { decoder } = fakeDecoder({
      decodeRaster: () => Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError')),
    })
    const result = await importImage(request([PNG]), { decoder })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('decode-failed')
    expect(result.error.detail).toContain('InvalidStateError')
  })

  it('keeps specific errors thrown as ImportFailure', async () => {
    const { decoder, calls } = fakeDecoder({
      toImageData: () => {
        throw new ImportFailure(createImportError('svg-render-blocked', 'SecurityError'))
      },
    })
    const result = await importImage(request([PNG]), { decoder })
    expect(!result.ok && result.error.code).toBe('svg-render-blocked')
    expect(calls.release).toBe(1)
  })

  it('never throws, even when the decoder throws synchronously', async () => {
    const decoder: ImportDecoder = {
      decodeRaster: () => {
        throw new TypeError('boom')
      },
      parseSvg: () => {
        throw new TypeError('boom')
      },
      rasteriseSvg: () => Promise.reject(new Error('unused')),
    }
    for (const content of [PNG, ascii(SVG_MARKUP)]) {
      const result = await importImage(request([content]), { decoder })
      expect(!result.ok && result.error.code).toBe('decode-failed')
    }
  })

  it('reports read failures', async () => {
    const { decoder } = fakeDecoder()
    const svgBytes = ascii(SVG_MARKUP)
    const unreadableText = {
      size: svgBytes.length,
      slice: (start: number, end: number) => new Blob([svgBytes]).slice(start, end),
      text: () => Promise.reject(new DOMException('File changed', 'NotReadableError')),
    } as unknown as Blob
    const result = await importImage({ blob: unreadableText, name: 'a.svg', source: 'drop' }, { decoder })
    expect(!result.ok && result.error.code).toBe('read-failed')
  })
})

describe('importImage: SVG', () => {
  it('rasterises at the resolved size and creates a document', async () => {
    const { decoder, calls } = fakeDecoder({ svgTrees: { [SVG_MARKUP]: svgRoot({ viewBox: '0 0 40 30' }) } })
    const result = await importImage(request([SVG_MARKUP], 'logo.svg'), { decoder })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document).toMatchObject({ format: 'svg', width: 40, height: 30, name: 'logo.svg' })
    expect(calls.parseSvg).toEqual([SVG_MARKUP])
    expect(calls.rasteriseSvg).toEqual([{ width: 40, height: 30 }])
    expect(calls.decodeRaster).toEqual([])
    expect(calls.release).toBe(1)
  })

  it('converts physical units', async () => {
    const { decoder, calls } = fakeDecoder({
      svgTrees: { [SVG_MARKUP]: svgRoot({ width: '210mm', height: '297mm', viewBox: '0 0 210 297' }) },
    })
    await importImage(request([SVG_MARKUP]), { decoder })
    expect(calls.rasteriseSvg).toEqual([{ width: 794, height: 1123 }])
  })

  it('rejects malformed XML', async () => {
    const { decoder, calls } = fakeDecoder({ svgTrees: {} })
    const result = await importImage(request([SVG_MARKUP]), { decoder })
    expect(!result.ok && result.error.code).toBe('decode-failed')
    expect(calls.rasteriseSvg).toEqual([])
  })

  it('imports ordinary markup with an XML declaration and comments', async () => {
    const markup = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator -->\n' + SVG_MARKUP
    const { decoder, calls } = fakeDecoder({ svgTrees: { [markup]: svgRoot({ viewBox: '0 0 40 30' }) } })
    const result = await importImage(request([markup]), { decoder })
    expect(result.ok).toBe(true)
    expect(calls.parseSvg).toEqual([markup])
  })

  it('rejects DOCTYPE and entity declarations before parsing', async () => {
    for (const markup of [
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">' + SVG_MARKUP,
      '<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>' + SVG_MARKUP,
    ]) {
      const { decoder, calls } = fakeDecoder({ svgTrees: { [markup]: svgRoot({ viewBox: '0 0 40 30' }) } })
      const result = await importImage(request([markup]), { decoder })
      expect(!result.ok && result.error.code).toBe('svg-unsupported-content')
      expect(calls.parseSvg).toEqual([])
      expect(calls.rasteriseSvg).toEqual([])
    }
  })

  it('rejects unsafe content without rasterising', async () => {
    const script: SvgElementLike = {
      localName: 'script',
      namespaceURI: SVG_NAMESPACE,
      textContent: 'alert(1)',
      children: [],
      getAttributeNames: () => [],
      getAttribute: () => null,
    }
    const { decoder, calls } = fakeDecoder({ svgTrees: { [SVG_MARKUP]: svgRoot({ viewBox: '0 0 40 30' }, [script]) } })
    const result = await importImage(request([SVG_MARKUP]), { decoder })
    expect(!result.ok && result.error.code).toBe('svg-unsupported-content')
    expect(calls.rasteriseSvg).toEqual([])
  })

  it('rejects SVGs without a usable size', async () => {
    const { decoder, calls } = fakeDecoder({ svgTrees: { [SVG_MARKUP]: svgRoot({ width: '100%', height: '100%' }) } })
    const result = await importImage(request([SVG_MARKUP]), { decoder })
    expect(!result.ok && result.error.code).toBe('svg-size-unknown')
    expect(calls.rasteriseSvg).toEqual([])
  })

  it('rejects SVG sizes over the limits before rasterising', async () => {
    const oversized: Record<string, string>[] = [
      { width: '16385', height: '10' },
      { viewBox: '0 0 8000 8000' },
      { width: '1000in', height: '1in' },
    ]
    for (const attributes of oversized) {
      const { decoder, calls } = fakeDecoder({ svgTrees: { [SVG_MARKUP]: svgRoot(attributes) } })
      const result = await importImage(request([SVG_MARKUP]), { decoder })
      expect(!result.ok && result.error.code).toBe('dimensions-too-large')
      expect(calls.rasteriseSvg).toEqual([])
    }
  })
})

describe('importImage: cancellation', () => {
  it('skips decoding when already cancelled', async () => {
    const { decoder, calls } = fakeDecoder()
    const controller = new AbortController()
    controller.abort()
    const result = await importImage(request([PNG]), { decoder, signal: controller.signal })
    expect(result.ok).toBe(false)
    expect(calls.decodeRaster).toEqual([])
  })

  it('releases the decoded image without allocating pixels when cancelled during decoding', async () => {
    const controller = new AbortController()
    const { decoder, calls } = fakeDecoder()
    const decodeRaster = decoder.decodeRaster
    const cancelling = {
      ...decoder,
      decodeRaster: async (blob: Blob, format: RasterFormat) => {
        const source = await decodeRaster(blob, format)
        controller.abort()
        return source
      },
    }
    const result = await importImage(request([PNG]), { decoder: cancelling, signal: controller.signal })
    expect(result.ok).toBe(false)
    expect(calls.toImageData).toBe(0)
    expect(calls.release).toBe(1)
  })
})
