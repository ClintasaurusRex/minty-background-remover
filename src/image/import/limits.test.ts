import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_LIMITS, validateDimensions, validateFileSize } from './limits'

const MAX_BYTES = 50 * 1024 * 1024

describe('DEFAULT_IMPORT_LIMITS', () => {
  it('matches the approved limits', () => {
    expect(DEFAULT_IMPORT_LIMITS).toEqual({
      maxFileBytes: MAX_BYTES,
      maxDimension: 16_384,
      maxPixels: 50_000_000,
    })
  })
})

describe('validateFileSize', () => {
  it('accepts sizes up to and including the limit', () => {
    expect(validateFileSize(0)).toBeNull()
    expect(validateFileSize(1)).toBeNull()
    expect(validateFileSize(MAX_BYTES - 1)).toBeNull()
    expect(validateFileSize(MAX_BYTES)).toBeNull()
  })

  it('rejects sizes over the limit', () => {
    expect(validateFileSize(MAX_BYTES + 1)?.code).toBe('file-too-large')
    expect(validateFileSize(10 * MAX_BYTES)?.code).toBe('file-too-large')
  })

  it('includes the sizes in the developer detail', () => {
    expect(validateFileSize(MAX_BYTES + 1)?.detail).toContain(String(MAX_BYTES + 1))
  })

  it('treats invalid sizes as read failures', () => {
    for (const size of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateFileSize(size)?.code).toBe('read-failed')
    }
  })

  it('honours custom limits', () => {
    const limits = { ...DEFAULT_IMPORT_LIMITS, maxFileBytes: 100 }
    expect(validateFileSize(100, limits)).toBeNull()
    expect(validateFileSize(101, limits)?.code).toBe('file-too-large')
  })
})

describe('validateDimensions', () => {
  it('accepts typical and minimal sizes', () => {
    expect(validateDimensions({ width: 1, height: 1 })).toBeNull()
    expect(validateDimensions({ width: 1920, height: 1080 })).toBeNull()
    expect(validateDimensions({ width: 3840, height: 2160 })).toBeNull()
    expect(validateDimensions({ width: 7680, height: 4320 })).toBeNull() // 8K, 33.2 MP
  })

  it('accepts exactly the maximum side', () => {
    expect(validateDimensions({ width: 16_384, height: 1 })).toBeNull()
    expect(validateDimensions({ width: 1, height: 16_384 })).toBeNull()
    expect(validateDimensions({ width: 16_384, height: 3051 })).toBeNull() // 49.99 MP
  })

  it('rejects a side over the maximum, even when the area is small', () => {
    expect(validateDimensions({ width: 16_385, height: 1 })?.code).toBe('dimensions-too-large')
    expect(validateDimensions({ width: 1, height: 16_385 })?.code).toBe('dimensions-too-large')
  })

  it('accepts exactly the maximum area and rejects one pixel more', () => {
    expect(validateDimensions({ width: 10_000, height: 5_000 })).toBeNull()
    expect(validateDimensions({ width: 5_000, height: 10_000 })).toBeNull()
    expect(validateDimensions({ width: 10_000, height: 5_001 })?.code).toBe('dimensions-too-large')
    expect(validateDimensions({ width: 7071, height: 7071 })).toBeNull() // 49,999,041 px
    expect(validateDimensions({ width: 7072, height: 7071 })?.code).toBe('dimensions-too-large') // 50,006,112 px
  })

  it('rejects areas over the maximum when both sides are allowed', () => {
    expect(validateDimensions({ width: 8000, height: 8000 })?.code).toBe('dimensions-too-large')
    expect(validateDimensions({ width: 16_384, height: 3052 })?.code).toBe('dimensions-too-large')
    expect(validateDimensions({ width: 16_384, height: 16_384 })?.code).toBe('dimensions-too-large')
  })

  it('rejects zero, negative, fractional and non-finite dimensions', () => {
    const invalid = [
      { width: 0, height: 100 },
      { width: 100, height: 0 },
      { width: -1, height: 100 },
      { width: 100, height: -100 },
      { width: 10.5, height: 100 },
      { width: Number.NaN, height: 100 },
      { width: 100, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 100 },
      { width: 100, height: Number.NEGATIVE_INFINITY },
    ]
    for (const size of invalid) {
      expect(validateDimensions(size)?.code).toBe('decode-failed')
    }
  })

  it('honours custom limits', () => {
    const limits = { ...DEFAULT_IMPORT_LIMITS, maxDimension: 100, maxPixels: 5000 }
    expect(validateDimensions({ width: 100, height: 50 }, limits)).toBeNull()
    expect(validateDimensions({ width: 101, height: 10 }, limits)?.code).toBe('dimensions-too-large')
    expect(validateDimensions({ width: 100, height: 51 }, limits)?.code).toBe('dimensions-too-large')
  })
})
