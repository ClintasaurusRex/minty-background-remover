import { describe, expect, it } from 'vitest'
import { FORMAT_SNIFF_BYTES, detectImageFormat, inspectImageFile } from './formats'
import { DEFAULT_IMPORT_LIMITS } from './limits'

// Minimal headers: only the leading bytes matter for detection.
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)
const JPEG_EXIF = bytes(0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34, 0x45, 0x78, 0x69, 0x66)
const WEBP = concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WEBPVP8 '))
const GIF87 = ascii('GIF87a\x01\x00\x01\x00')
const GIF89 = ascii('GIF89a\x01\x00\x01\x00')
const BMP = concat(ascii('BM'), bytes(0x3a, 0, 0, 0, 0, 0, 0, 0))
const TIFF_LE = bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0)
const TIFF_BE = bytes(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08)
const WAV = concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WAVEfmt '))
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values)
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

describe('detectImageFormat', () => {
  it('recognises supported signatures', () => {
    expect(detectImageFormat(PNG)).toBe('png')
    expect(detectImageFormat(JPEG)).toBe('jpeg')
    expect(detectImageFormat(JPEG_EXIF)).toBe('jpeg')
    expect(detectImageFormat(WEBP)).toBe('webp')
    expect(detectImageFormat(utf8(SVG))).toBe('svg')
  })

  it('needs only the signature bytes', () => {
    expect(detectImageFormat(PNG.subarray(0, 8))).toBe('png')
    expect(detectImageFormat(JPEG.subarray(0, 3))).toBe('jpeg')
    expect(detectImageFormat(WEBP.subarray(0, 12))).toBe('webp')
  })

  it('rejects unsupported image formats', () => {
    for (const head of [GIF87, GIF89, BMP, TIFF_LE, TIFF_BE]) {
      expect(detectImageFormat(head)).toBeNull()
    }
  })

  it('rejects RIFF containers that are not WebP', () => {
    expect(detectImageFormat(WAV)).toBeNull()
  })

  it('rejects empty and truncated input', () => {
    expect(detectImageFormat(new Uint8Array(0))).toBeNull()
    expect(detectImageFormat(PNG.subarray(0, 7))).toBeNull()
    expect(detectImageFormat(JPEG.subarray(0, 2))).toBeNull()
    expect(detectImageFormat(WEBP.subarray(0, 11))).toBeNull()
    expect(detectImageFormat(utf8('<sv'))).toBeNull()
    expect(detectImageFormat(utf8('<svg'))).toBeNull()
  })

  it('rejects signatures that are corrupted or not at the start', () => {
    const corrupted = PNG.slice()
    corrupted[4] = 0x0a // newline translation damage
    expect(detectImageFormat(corrupted)).toBeNull()
    expect(detectImageFormat(concat(bytes(0), PNG))).toBeNull()
    expect(detectImageFormat(concat(bytes(0x20), JPEG))).toBeNull()
  })

  describe('SVG', () => {
    it('accepts the XML declaration, comments, DOCTYPE, whitespace and BOM before <svg>', () => {
      const prologues = [
        '',
        '\n\t  ',
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n',
        '<!-- Created with Inkscape -->\n',
        '<?xml version="1.0"?><!-- a --><!-- b -->\n',
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n',
        // Illustrator-style internal subset containing '>' characters.
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [\n<!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">\n]>\n',
        '<?xml-stylesheet href="style.css"?>\n',
      ]
      for (const prologue of prologues) {
        expect(detectImageFormat(utf8(prologue + SVG))).toBe('svg')
      }
      expect(detectImageFormat(concat(bytes(0xef, 0xbb, 0xbf), utf8(SVG)))).toBe('svg')
    })

    it('accepts <svg> followed by whitespace, ">" or "/"', () => {
      expect(detectImageFormat(utf8('<svg>'))).toBe('svg')
      expect(detectImageFormat(utf8('<svg/>'))).toBe('svg')
      expect(detectImageFormat(utf8('<svg\nxmlns="http://www.w3.org/2000/svg">'))).toBe('svg')
    })

    it('rejects documents whose root element is not <svg>', () => {
      const others = [
        '<html><svg></svg></html>',
        '<!DOCTYPE html><html></html>',
        '<svgfoo>',
        '<SVG>',
        '<?xml version="1.0"?><rss></rss>',
        'not markup <svg>',
        'svg',
      ]
      for (const text of others) {
        expect(detectImageFormat(utf8(text))).toBeNull()
      }
    })

    it('rejects unterminated prologues', () => {
      expect(detectImageFormat(utf8('<?xml version="1.0"'))).toBeNull()
      expect(detectImageFormat(utf8('<!-- never closed <svg>'))).toBeNull()
      expect(detectImageFormat(utf8('<!DOCTYPE svg [ <svg>'))).toBeNull()
    })

    it('rejects an SVG whose root element starts beyond the sniffed bytes', () => {
      const longComment = `<!--${' '.repeat(FORMAT_SNIFF_BYTES)}-->`
      const head = utf8(longComment + SVG).subarray(0, FORMAT_SNIFF_BYTES)
      expect(detectImageFormat(head)).toBeNull()
    })

    it('rejects UTF-16 encoded SVG', () => {
      const utf16 = Uint8Array.from([0xff, 0xfe, ...Array.from(SVG).flatMap((c) => [c.charCodeAt(0), 0])])
      expect(detectImageFormat(utf16)).toBeNull()
    })
  })
})

describe('inspectImageFile', () => {
  it('identifies formats from content regardless of misleading names and MIME types', async () => {
    const cases: [Uint8Array<ArrayBuffer>, string, string, string][] = [
      [PNG, 'photo.jpg', 'image/jpeg', 'png'],
      [JPEG, 'screenshot.png', 'image/png', 'jpeg'],
      [WEBP, 'image', '', 'webp'],
      [utf8(SVG), 'drawing.txt', 'text/plain', 'svg'],
      [PNG, 'archive.zip', 'application/zip', 'png'],
    ]
    for (const [content, name, type, expected] of cases) {
      const result = await inspectImageFile(new File([content], name, { type }))
      expect(result).toEqual({ ok: true, format: expected })
    }
  })

  it('rejects unsupported content even with a supported name and MIME type', async () => {
    for (const content of [GIF89, BMP, TIFF_LE, utf8('hello')]) {
      const result = await inspectImageFile(new File([content], 'image.png', { type: 'image/png' }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('unsupported-format')
    }
  })

  it('works on unnamed Blobs such as clipboard data', async () => {
    expect(await inspectImageFile(new Blob([PNG]))).toEqual({ ok: true, format: 'png' })
  })

  it('reports empty files as failed to open', async () => {
    const result = await inspectImageFile(new File([], 'empty.png', { type: 'image/png' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('decode-failed')
  })

  it('rejects files over the size limit without reading them', async () => {
    let sliced = false
    const oversized = {
      size: DEFAULT_IMPORT_LIMITS.maxFileBytes + 1,
      slice() {
        sliced = true
        throw new Error('should not read')
      },
    } as unknown as Blob
    const result = await inspectImageFile(oversized)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('file-too-large')
    expect(sliced).toBe(false)
  })

  it('accepts a file exactly at the size limit', async () => {
    const limits = { ...DEFAULT_IMPORT_LIMITS, maxFileBytes: PNG.length }
    expect(await inspectImageFile(new Blob([PNG]), limits)).toEqual({ ok: true, format: 'png' })
    const tooBig = await inspectImageFile(new Blob([PNG, bytes(0)]), limits)
    expect(tooBig.ok).toBe(false)
  })

  it('reports read failures', async () => {
    const unreadable = {
      size: 100,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }),
    } as unknown as Blob
    const result = await inspectImageFile(unreadable)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('read-failed')
  })

  it('reads only the first FORMAT_SNIFF_BYTES', async () => {
    let requested: [number?, number?] = []
    const blob = new Blob([PNG, new Uint8Array(100_000)])
    const spy = {
      size: blob.size,
      slice: (start?: number, end?: number) => {
        requested = [start, end]
        return blob.slice(start, end)
      },
    } as unknown as Blob
    await inspectImageFile(spy)
    expect(requested).toEqual([0, FORMAT_SNIFF_BYTES])
  })
})
