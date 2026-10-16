import { describe, expect, it } from 'vitest'
import { formatDimensions, formatFileSize, formatLabel, formatZoom } from './documentInfo'
import type { ImageFormat } from './types'

describe('documentInfo', () => {
  it('labels formats', () => {
    const formats: ImageFormat[] = ['png', 'jpeg', 'webp', 'svg']
    expect(formats.map(formatLabel)).toEqual([
      'PNG',
      'JPEG',
      'WebP',
      'SVG',
    ])
  })

  it('formats dimensions with thousands separators', () => {
    expect(formatDimensions(16384, 3072)).toBe('16,384 × 3,072 px')
    expect(formatDimensions(1, 1)).toBe('1 × 1 px')
  })

  it('formats file sizes in binary units', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(250 * 1024)).toBe('250 KB')
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3.3 MB')
    expect(formatFileSize(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatFileSize(Number.NaN)).toBe('')
  })

  it('formats zoom as a percentage', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.2479)).toBe('25%')
    expect(formatZoom(32)).toBe('3200%')
    expect(formatZoom(0.025)).toBe('2.5%')
    expect(formatZoom(0.01)).toBe('1%')
  })
})
