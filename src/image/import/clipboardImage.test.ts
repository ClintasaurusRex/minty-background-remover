import { describe, expect, it } from 'vitest'
import { choosePastedImage, pastedImageName } from './clipboardImage'
import { sniffImageFormat } from './formats'
import { ascii, jpegFile, pngFile, webpVp8lHeader } from './testFixtures'

const blob = (...parts: BlobPart[]) => new Blob(parts)

describe('sniffImageFormat', () => {
  it('identifies clipboard image data from its content', async () => {
    expect(await sniffImageFormat(blob(pngFile(4, 3)))).toBe('png')
    expect(await sniffImageFormat(blob(jpegFile(4, 3)))).toBe('jpeg')
    expect(await sniffImageFormat(blob(webpVp8lHeader(4, 3)))).toBe('webp')
  })

  it('returns null for text, unsupported images, empty and unreadable data', async () => {
    expect(await sniffImageFormat(blob('<p>Hello</p>'))).toBeNull()
    expect(await sniffImageFormat(blob(ascii('GIF89a')))).toBeNull()
    expect(await sniffImageFormat(blob())).toBeNull()
    const unreadable = { slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) } as unknown as Blob
    expect(await sniffImageFormat(unreadable)).toBeNull()
  })
})

describe('choosePastedImage', () => {
  it('chooses the first supported image and reports its format', async () => {
    const png = blob(pngFile(4, 3))
    expect(await choosePastedImage([blob('text'), png, blob(jpegFile(4, 3))])).toEqual({ blob: png, format: 'png' })
  })

  it('returns null for an empty clipboard or one without supported images', async () => {
    expect(await choosePastedImage([])).toBeNull()
    expect(await choosePastedImage([blob(ascii('GIF89a')), blob('just text')])).toBeNull()
  })
})

describe('pastedImageName', () => {
  it('uses the local date and time and the detected format', () => {
    const date = new Date(2026, 9, 22, 9, 5, 7)
    expect(pastedImageName('png', date)).toBe('pasted-image-2026-10-22-090507.png')
    expect(pastedImageName('jpeg', date)).toBe('pasted-image-2026-10-22-090507.jpg')
    expect(pastedImageName('webp', date)).toBe('pasted-image-2026-10-22-090507.webp')
    expect(pastedImageName('svg', date)).toBe('pasted-image-2026-10-22-090507.svg')
  })
})
