import { describe, expect, it } from 'vitest'
import { chooseDroppedFile, hasSupportedContent, isFileDrag } from './droppedFiles'
import { ascii, pngFile } from './testFixtures'

const file = (content: BlobPart[], name: string) => new File(content, name)
const png = (name = 'a.png') => file([pngFile(4, 3)], name)
const text = (name = 'notes.txt') => file(['just some text'], name)
const svg = (name = 'logo.svg') => file(['<svg xmlns="http://www.w3.org/2000/svg"/>'], name)

describe('isFileDrag', () => {
  it('recognises drags that carry files', () => {
    expect(isFileDrag(['Files'])).toBe(true)
    // Firefox lists its own type alongside Files.
    expect(isFileDrag(['application/x-moz-file', 'Files'])).toBe(true)
  })

  it('ignores text, links and missing data', () => {
    expect(isFileDrag(['text/plain'])).toBe(false)
    expect(isFileDrag(['text/uri-list', 'text/plain', 'text/html'])).toBe(false)
    expect(isFileDrag([])).toBe(false)
    expect(isFileDrag(null)).toBe(false)
    expect(isFileDrag(undefined)).toBe(false)
  })
})

describe('hasSupportedContent', () => {
  it('identifies supported images from their content, not their names', async () => {
    expect(await hasSupportedContent(png('photo.jpg'))).toBe(true)
    expect(await hasSupportedContent(svg('drawing.txt'))).toBe(true)
    expect(await hasSupportedContent(text('image.png'))).toBe(false)
    expect(await hasSupportedContent(file([ascii('GIF89a')], 'anim.gif'))).toBe(false)
    expect(await hasSupportedContent(file([], 'empty.png'))).toBe(false)
  })

  it('treats unreadable files as unsupported', async () => {
    const unreadable = { slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) } as unknown as Blob
    expect(await hasSupportedContent(unreadable)).toBe(false)
  })
})

describe('chooseDroppedFile', () => {
  it('returns null when nothing was dropped', async () => {
    expect(await chooseDroppedFile([])).toBeNull()
  })

  it('opens a single file and ignores nothing', async () => {
    const only = png()
    expect(await chooseDroppedFile([only])).toEqual({ file: only, ignoredCount: 0 })
  })

  it('opens the first supported image and counts the rest as ignored', async () => {
    const first = svg()
    const files = [text(), first, png(), text('b.txt')]
    expect(await chooseDroppedFile(files)).toEqual({ file: first, ignoredCount: 3 })
  })

  it('returns the first file when none is supported, so the import can explain why', async () => {
    const files = [text('a.txt'), text('b.txt')]
    expect(await chooseDroppedFile(files)).toEqual({ file: files[0], ignoredCount: 1 })
  })

  it('stops checking at the first supported file', async () => {
    const checked: string[] = []
    const files = [text('a.txt'), png('b.png'), png('c.png')]
    await chooseDroppedFile(files, async (blob) => {
      const name = (blob as File).name
      checked.push(name)
      return name.endsWith('.png')
    })
    expect(checked).toEqual(['a.txt', 'b.png'])
  })
})
